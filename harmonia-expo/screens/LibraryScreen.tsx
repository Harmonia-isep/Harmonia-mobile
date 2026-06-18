import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, SafeAreaView, StatusBar, Platform, Modal,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
// SDK 56's default expo-file-system export is the new File/Paths API, which has no
// documentDirectory/writeAsStringAsync. The classic API lives at /legacy — that's
// what the cacheDirectory + writeAsStringAsync export flow below relies on.
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { theme } from '../constants/theme'
import { useTracks } from '../context/TrackContext'
import { useAuth } from '../context/AuthContext'
import { uploadTrack, deleteTrack, searchTracks, Track, BASE_URL } from '../data/api'
import { removeTrackFromAllPlaylists } from '../data/storage'
import { LibraryStackParamList } from '../types/navigation'

// Root-note keys — mirrors the web app's key filter which sends just the root
// to the backend (e.g. 'E' matches both 'E minor' and 'E major' tracks).
const KEYS = ['All Keys', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'Library'>

export default function LibraryScreen() {
  const nav = useNavigation<NavProp>()
  const { tracks, isLoading, isOffline, loadTracks, setTracks } = useTracks()
  const { user, logout } = useAuth()

  const [search,      setSearch]      = useState('')
  const [bpmMin,      setBpmMin]      = useState('')
  const [bpmMax,      setBpmMax]      = useState('')
  const [selKey,      setSelKey]      = useState('All Keys')
  const [showKeys,    setShowKeys]    = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  // The list the FlatList renders. Kept separate from the context `tracks` (the full
  // library used by Compare/Playlist screens) so filtering never hides tracks elsewhere.
  const [results,     setResults]     = useState<Track[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Upload form modal
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [pendingAsset,   setPendingAsset]   = useState<{
    uri: string; name: string; mimeType: string; file?: File
  } | null>(null)
  const [formTitle,  setFormTitle]  = useState('')
  const [formArtist, setFormArtist] = useState('')
  const [formAlbum,  setFormAlbum]  = useState('')

  // Keep the context's full library loaded — Compare / Playlist screens and the
  // detail-screen analysis patch all read from it.
  useFocusEffect(useCallback(() => { loadTracks() }, [loadTracks]))

  const noFilters = !search && selKey === 'All Keys' && !bpmMin && !bpmMax

  // No filters → show the full library straight from context, instantly, no network.
  useEffect(() => {
    if (noFilters) setResults(tracks)
  }, [tracks, noFilters])

  // A filter is active → ask the backend (debounced 400 ms, exactly like the web).
  // The list endpoint omits key/bpm (they live on the Analysis table), so the server
  // must do the JOIN/filter; the device has no key/bpm data to filter on locally.
  useEffect(() => {
    if (noFilters) return
    setIsSearching(true)
    const handle = setTimeout(async () => {
      try {
        const data = await searchTracks({
          search:  search || undefined,
          key:     selKey !== 'All Keys' ? selKey : undefined,
          bpm_min: bpmMin || undefined,
          bpm_max: bpmMax || undefined,
        })
        setResults(data)
      } catch {
        // keep the previous results on a transient/cold-start error
      } finally {
        setIsSearching(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [search, selKey, bpmMin, bpmMax, noFilters])

  // Alert.alert button callbacks are no-ops on React Native Web; use window.alert instead.
  function nativeAlert(title: string, message: string) {
    if (Platform.OS === 'web') window.alert(`${title}\n${message}`)
    else Alert.alert(title, message)
  }

  // ── UC01: Upload ──────────────────────────────────────────────────────

  // Mirrors the web Upload.js parseFilename: "Artist - Title.mp3" → { artist, title }
  function parseFilename(filename: string): { title: string; artist: string } {
    const nameNoExt = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
    const parts = nameNoExt.split(' - ')
    if (parts.length >= 2) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
    }
    return { artist: '', title: nameNoExt.trim() }
  }

  // Step 1 — open file picker, then show the metadata form
  async function handleUpload() {
    let result
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/*'],
        ...(Platform.OS !== 'web' && { copyToCacheDirectory: true }),
      })
    } catch (e: any) {
      nativeAlert('Picker Error', e.message ?? 'Could not open the file picker.')
      return
    }
    if (result.canceled || !result.assets?.length) return

    const asset = result.assets[0]
    const ext   = asset.name.split('.').pop()?.toLowerCase()
    if (ext !== 'mp3' && ext !== 'wav') {
      nativeAlert('Unsupported Format', 'Only MP3 and WAV files are supported.')
      return
    }

    // Pre-fill form from filename — same logic as the web Upload component
    const { title, artist } = parseFilename(asset.name)
    setPendingAsset({
      uri:      asset.uri,
      name:     asset.name,
      mimeType: asset.mimeType ?? 'audio/mpeg',
      file:     Platform.OS === 'web' ? (asset as any).file : undefined,
    })
    setFormTitle(title)
    setFormArtist(artist)
    setFormAlbum('')
    setShowUploadForm(true)
  }

  // Step 2 — user confirms the metadata form
  async function handleUploadConfirm() {
    if (!pendingAsset) return
    if (!formTitle.trim()) {
      nativeAlert('Missing Title', 'Please enter a track title.')
      return
    }
    setShowUploadForm(false)
    setIsUploading(true)
    try {
      const track = await uploadTrack(
        pendingAsset.uri,
        pendingAsset.name,
        pendingAsset.mimeType,
        { title: formTitle.trim(), artist: formArtist.trim(), album: formAlbum.trim() },
        pendingAsset.file,
      )
      setTracks(prev => [track, ...prev])
      setResults(prev => [track, ...prev])
      nativeAlert('Uploaded!', `"${track.title}" added to your library.`)
    } catch (e: any) {
      nativeAlert('Upload Failed', e.message ?? 'Could not upload the file.')
    } finally {
      setIsUploading(false)
      setPendingAsset(null)
    }
  }

  // ── UC05: Delete ──────────────────────────────────────────────────────

  function handleDelete(trackId: number, title: string) {
    const doDelete = async () => {
      if (isOffline) {
        setTracks(prev => prev.filter(t => t.id !== trackId))
        setResults(prev => prev.filter(t => t.id !== trackId))
        if (user) await removeTrackFromAllPlaylists(user.id, trackId)
        return
      }
      const ok = await deleteTrack(trackId)
      if (ok) {
        setTracks(prev => prev.filter(t => t.id !== trackId))
        setResults(prev => prev.filter(t => t.id !== trackId))
        if (user) await removeTrackFromAllPlaylists(user.id, trackId)
      } else {
        nativeAlert('Error', 'Could not delete the track.')
      }
    }
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${title}"?\nThis cannot be undone.`)) doDelete()
    } else {
      Alert.alert('Delete Track', `Delete "${title}"?\nThis cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ])
    }
  }

  // ── UC08: CSV Export ─────────────────────────────────────────────────
  // Mirrors the web "Export CSV": the backend builds the full file (with BPM, key,
  // scale, energy, danceability from the Analysis table) — data the device doesn't
  // hold — so we download that, then hand the file to the native share sheet.
  // Falls back to a client-side CSV built from the visible library if the server
  // export is unreachable.

  function buildCsvFromTracks(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Title', 'Artist', 'BPM', 'Key', 'Energy', 'Danceability']
    const rows = results.map(t => [
      esc(t.title), esc(t.artist), esc(t.bpm), esc(t.key), esc(''), esc(''),
    ].join(','))
    return [header.join(','), ...rows].join('\n')
  }

  // Web has no expo-file-system/expo-sharing — drive a real browser download
  // instead (saves straight to the user's Downloads folder), mirroring the web app.
  function downloadCsvWeb(csv: string, filename: string) {
    // Leading UTF-8 BOM (﻿) so Excel renders accented characters correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Revoke on the next tick so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function handleExport() {
    if (!user) return
    setIsExporting(true)
    try {
      // Prefer the rich server-generated file (matches the web download exactly);
      // fall back to a client-side CSV built from the visible library.
      let csv: string
      try {
        const resp = await fetch(`${BASE_URL}/api/tracks/user/${user.id}/export`)
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`)
        csv = await resp.text()
      } catch {
        csv = buildCsvFromTracks()   // offline / server down → degrade gracefully
      }

      if (Platform.OS === 'web') {
        downloadCsvWeb(csv, 'harmonia_export.csv')
        return
      }

      // Native (iOS/Android): write to cache, then open the share sheet.
      if (!(await Sharing.isAvailableAsync())) {
        nativeAlert('Sharing Unavailable', 'Sharing is not available on this device.')
        return
      }
      const path = `${FileSystem.cacheDirectory}harmonia_export.csv`
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 })
      await Sharing.shareAsync(path, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Library CSV',
        UTI: 'public.comma-separated-values-text',
      })
    } catch (e: any) {
      nativeAlert('Export Failed', e.message ?? 'Could not export the library.')
    } finally {
      setIsExporting(false)
    }
  }

  function handleLogout() {
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out of Harmonia?')) logout()
    } else {
      Alert.alert('Sign Out', 'Sign out of Harmonia?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ])
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  const statusText = (isLoading || isSearching)
    ? 'Loading…'
    : isOffline
    ? '⚠  Offline — showing demo tracks'
    : noFilters
    ? `${results.length} track${results.length !== 1 ? 's' : ''}`
    : results.length === 0
    ? 'No tracks found'
    : `${results.length} result${results.length !== 1 ? 's' : ''}`

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.BG_PRIMARY} />
      <View style={s.root}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>My Library</Text>
          <View style={s.btns}>
            <IconBtn iconName="refresh-outline"    color={theme.TEXT_SECONDARY} onPress={loadTracks} />
            <IconBtn
              iconName={isUploading ? 'hourglass-outline' : 'cloud-upload-outline'}
              color={theme.ACCENT} onPress={handleUpload} disabled={isUploading}
            />
            <IconBtn
              iconName={isExporting ? 'hourglass-outline' : 'download-outline'}
              color={theme.SUCCESS} onPress={handleExport} disabled={!tracks.length || isExporting}
            />
            <IconBtn iconName="log-out-outline" color={theme.TEXT_TERTIARY} onPress={handleLogout} />
          </View>
        </View>

        {/* UC03: Search */}
        <TextInput
          style={s.search}
          placeholder="Search by title or artist…"
          placeholderTextColor={theme.TEXT_TERTIARY}
          value={search} onChangeText={setSearch}
        />

        {/* UC03: Filters */}
        <View style={s.filterRow}>
          <Text style={s.filterLbl}>BPM:</Text>
          <TextInput style={s.bpmIn} placeholder="min" placeholderTextColor={theme.TEXT_TERTIARY}
            keyboardType="numeric" value={bpmMin} onChangeText={setBpmMin} />
          <Text style={s.filterLbl}>–</Text>
          <TextInput style={s.bpmIn} placeholder="max" placeholderTextColor={theme.TEXT_TERTIARY}
            keyboardType="numeric" value={bpmMax} onChangeText={setBpmMax} />
          <Text style={s.filterLbl}>Key:</Text>
          <TouchableOpacity style={s.keyBtn} onPress={() => setShowKeys(!showKeys)}>
            <Text style={s.keyBtnTxt} numberOfLines={1}>{selKey}</Text>
          </TouchableOpacity>
        </View>

        {showKeys && (
          <View style={s.keyPicker}>
            <FlatList
              data={KEYS} keyExtractor={k => k} style={{ maxHeight: 160 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.keyItem, item === selKey && s.keyItemSel]}
                  onPress={() => { setSelKey(item); setShowKeys(false) }}
                >
                  <Text style={[s.keyItemTxt, item === selKey && { color: theme.BG_PRIMARY }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <Text style={s.status}>{statusText}</Text>

        {/* Track list */}
        {(isLoading || isSearching) && results.length === 0
          ? <ActivityIndicator color={theme.ACCENT} style={{ marginTop: 40 }} />
          : (
            <FlatList
              data={results}
              keyExtractor={t => String(t.id)}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={<Text style={s.empty}>No tracks found</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.card}
                  onPress={() => nav.navigate('TrackDetail', { trackId: item.id })}
                  activeOpacity={0.7}
                >
                  <Ionicons name="musical-note" size={18} color={theme.TEXT_TERTIARY} style={s.cardIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={s.cardArtist} numberOfLines={1}>
                      {item.artist}{item.album ? ` · ${item.album}` : ''}
                    </Text>
                  </View>
                  {(item.status?.toLowerCase().includes('analyz') && item.status !== 'analyzed') || item.status === 'pending'
                    ? <View style={s.pendingBadge}><Text style={s.pendingTxt}>Analyzing…</Text></View>
                    : <View style={s.bpmBadge}><Text style={s.bpmTxt}>{item.bpm !== '—' ? `${item.bpm} BPM` : '—'}</Text></View>
                  }
                  <TouchableOpacity style={s.delBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    onPress={() => handleDelete(item.id, item.title)}>
                    <Ionicons name="close" size={14} color={theme.TEXT_TERTIARY} />
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          )
        }
      </View>

      {/* ── Upload metadata form ─────────────────────────────────────── */}
      <Modal
        visible={showUploadForm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUploadForm(false)}
      >
        <View style={s.overlay}>
          <View style={s.uploadModal}>
            <Text style={s.uploadModalTitle}>Track Details</Text>
            <Text style={s.uploadModalSub}>
              {pendingAsset?.name ?? ''}
            </Text>

            <Text style={s.fieldLabel}>Title *</Text>
            <TextInput
              style={s.fieldInput}
              placeholder="Track title"
              placeholderTextColor={theme.TEXT_TERTIARY}
              value={formTitle}
              onChangeText={setFormTitle}
              autoFocus
            />

            <Text style={s.fieldLabel}>Artist</Text>
            <TextInput
              style={s.fieldInput}
              placeholder="Artist name"
              placeholderTextColor={theme.TEXT_TERTIARY}
              value={formArtist}
              onChangeText={setFormArtist}
              autoCapitalize="words"
            />

            <Text style={s.fieldLabel}>Album</Text>
            <TextInput
              style={s.fieldInput}
              placeholder="Album name (optional)"
              placeholderTextColor={theme.TEXT_TERTIARY}
              value={formAlbum}
              onChangeText={setFormAlbum}
              autoCapitalize="words"
            />

            <View style={s.uploadModalBtns}>
              <TouchableOpacity
                style={s.uploadCancelBtn}
                onPress={() => { setShowUploadForm(false); setPendingAsset(null) }}
              >
                <Text style={{ color: theme.TEXT_SECONDARY, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.uploadConfirmBtn} onPress={handleUploadConfirm}>
                <Ionicons name="cloud-upload-outline" size={14} color={theme.TEXT_PRIMARY} />
                <Text style={s.uploadConfirmTxt}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  )
}

function IconBtn({ iconName, color, onPress, disabled = false }: {
  iconName: string; color: string; onPress: () => void; disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[s.iconBtn, { borderColor: color, opacity: disabled ? 0.4 : 1 }]}
      onPress={onPress} disabled={disabled} activeOpacity={0.7}
    >
      <Ionicons name={iconName as any} size={16} color={color} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: theme.BG_PRIMARY },
  root:  { flex: 1, paddingHorizontal: 14, paddingTop: 14 },
  header:{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { color: theme.TEXT_PRIMARY, fontSize: 20, fontWeight: 'bold', flex: 1 },
  btns:  { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: 34, height: 34, borderRadius: theme.RADIUS_SM,
    borderWidth: 1, backgroundColor: theme.BG_SECONDARY,
    justifyContent: 'center', alignItems: 'center',
  },
  search: {
    backgroundColor: theme.BG_SECONDARY, color: theme.TEXT_PRIMARY,
    borderWidth: 1, borderColor: theme.BORDER, borderRadius: 19,
    paddingHorizontal: 14, height: 38, fontSize: 13, marginBottom: 8,
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  filterLbl: { color: theme.TEXT_TERTIARY, fontSize: 11 },
  bpmIn: {
    backgroundColor: theme.BG_SECONDARY, color: theme.TEXT_PRIMARY,
    borderWidth: 1, borderColor: theme.BORDER, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 4, width: 40, height: 26, fontSize: 11, textAlign: 'center',
  },
  keyBtn: {
    flex: 1, backgroundColor: theme.BG_SECONDARY, borderWidth: 1,
    borderColor: theme.BORDER, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 8, height: 26, justifyContent: 'center',
  },
  keyBtnTxt: { color: theme.TEXT_PRIMARY, fontSize: 11 },
  keyPicker: {
    backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_MD,
    borderWidth: 1, borderColor: theme.BORDER, marginBottom: 6,
  },
  keyItem:    { paddingVertical: 7, paddingHorizontal: 12 },
  keyItemSel: { backgroundColor: theme.ACCENT },
  keyItemTxt: { color: theme.TEXT_PRIMARY, fontSize: 12 },
  status: { color: theme.TEXT_SECONDARY, fontSize: 11, marginBottom: 8 },
  empty:  { color: theme.TEXT_TERTIARY, fontSize: 13, textAlign: 'center', paddingTop: 40 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 10, height: 56, marginBottom: 4,
  },
  cardIcon:   { width: 22 },
  cardTitle:  { color: theme.TEXT_PRIMARY, fontWeight: 'bold', fontSize: 13 },
  cardArtist: { color: theme.TEXT_SECONDARY, fontSize: 11 },
  pendingBadge: { backgroundColor: 'rgba(255,159,10,0.12)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  pendingTxt:   { color: theme.WARNING, fontSize: 11, fontWeight: 'bold' },
  bpmBadge:     { backgroundColor: theme.BG_ELEVATED, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  bpmTxt:       { color: theme.INFO, fontSize: 11, fontWeight: 'bold' },
  delBtn: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },

  // Upload metadata modal
  overlay:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  uploadModal:    { backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_LG, padding: 20, width: 320 },
  uploadModalTitle: { color: theme.TEXT_PRIMARY, fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  uploadModalSub:   { color: theme.TEXT_TERTIARY, fontSize: 11, marginBottom: 16 },
  fieldLabel:     { color: theme.TEXT_SECONDARY, fontSize: 11, fontWeight: '600', marginBottom: 4, marginTop: 8 },
  fieldInput: {
    backgroundColor: theme.BG_TERTIARY, color: theme.TEXT_PRIMARY,
    borderWidth: 1, borderColor: theme.BORDER, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 12, height: 40, fontSize: 13,
  },
  uploadModalBtns:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  uploadCancelBtn:  { paddingHorizontal: 12, paddingVertical: 9 },
  uploadConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.ACCENT, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  uploadConfirmTxt: { color: theme.TEXT_PRIMARY, fontWeight: 'bold', fontSize: 13 },
})
