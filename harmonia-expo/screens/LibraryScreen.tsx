import React, { useState, useCallback, useMemo } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, SafeAreaView, StatusBar, Platform,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { theme } from '../constants/theme'
import { useTracks } from '../context/TrackContext'
import { useAuth } from '../context/AuthContext'
import { uploadTrack, deleteTrack } from '../data/api'
import { LibraryStackParamList } from '../types/navigation'

const KEYS = [
  'All Keys','C major','G major','D major','A major','E major','B major',
  'F major','Bb major','Eb major','Ab major',
  'A minor','E minor','B minor','F# minor','C# minor',
  'D minor','G minor','C minor','F minor',
]

type NavProp = NativeStackNavigationProp<LibraryStackParamList, 'Library'>

export default function LibraryScreen() {
  const nav = useNavigation<NavProp>()
  const { tracks, isLoading, isOffline, loadTracks, setTracks } = useTracks()
  const { logout } = useAuth()

  const [search,      setSearch]      = useState('')
  const [bpmMin,      setBpmMin]      = useState('')
  const [bpmMax,      setBpmMax]      = useState('')
  const [selKey,      setSelKey]      = useState('All Keys')
  const [showKeys,    setShowKeys]    = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useFocusEffect(useCallback(() => { loadTracks() }, [loadTracks]))

  // Alert.alert button callbacks are no-ops on React Native Web; use window.alert instead.
  function nativeAlert(title: string, message: string) {
    if (Platform.OS === 'web') window.alert(`${title}\n${message}`)
    else Alert.alert(title, message)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tracks.filter(t => {
      if (q && !t.title.toLowerCase().includes(q) && !t.artist.toLowerCase().includes(q)) return false
      const bpm = typeof t.bpm === 'number' ? t.bpm : null
      if (bpmMin && bpm !== null && bpm < parseInt(bpmMin, 10)) return false
      if (bpmMax && bpm !== null && bpm > parseInt(bpmMax, 10)) return false
      if (selKey !== 'All Keys' && !t.key.toLowerCase().includes(selKey.toLowerCase())) return false
      return true
    })
  }, [tracks, search, bpmMin, bpmMax, selKey])

  // ── UC01: Upload ──────────────────────────────────────────────────────

  async function handleUpload() {
    let result
    try {
      result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/*'],
        // copyToCacheDirectory is native-only and breaks the web picker when set
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

    setIsUploading(true)
    try {
      // On web, expo-document-picker exposes the real File object on asset.file.
      // On native, we pass the URI and let the native fetch handle it.
      const fileBlob = Platform.OS === 'web' ? (asset as any).file as File : undefined
      const track = await uploadTrack(asset.uri, asset.name, asset.mimeType ?? 'audio/mpeg', fileBlob)
      setTracks(prev => [track, ...prev])
      nativeAlert('Uploaded!', `"${track.title}" is queued for analysis.`)
    } catch (e: any) {
      nativeAlert('Upload Failed', e.message ?? 'Could not upload the file.')
    } finally {
      setIsUploading(false)
    }
  }

  // ── UC05: Delete ──────────────────────────────────────────────────────

  function handleDelete(trackId: number, title: string) {
    const doDelete = async () => {
      if (isOffline) { setTracks(prev => prev.filter(t => t.id !== trackId)); return }
      const ok = await deleteTrack(trackId)
      if (ok) setTracks(prev => prev.filter(t => t.id !== trackId))
      else nativeAlert('Error', 'Could not delete the track.')
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

  // ── UC08: CSV Export ──────────────────────────────────────────────────

  async function handleExport() {
    if (!tracks.length) return
    setIsExporting(true)
    try {
      const header = 'title,artist,duration,bpm,key,upload_date'
      const rows = tracks.map(t =>
        [t.title, t.artist, t.duration, t.bpm, t.key, t.upload_date ?? '—']
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      const csv  = [header, ...rows].join('\n')
      const fs   = FileSystem as any
      const dir  = fs.documentDirectory ?? fs.cacheDirectory ?? ''
      const path = `${dir}harmonia_library.csv`
      await (FileSystem as any).writeAsStringAsync(path, csv, { encoding: 'utf8' })
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Library CSV' })
    } catch (e: any) {
      Alert.alert('Export Failed', e.message)
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

  const statusText = isLoading
    ? 'Loading…'
    : isOffline
    ? '⚠  Offline — showing demo tracks'
    : filtered.length === tracks.length
    ? `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`
    : filtered.length === 0
    ? 'No tracks found'
    : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`

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
        {isLoading
          ? <ActivityIndicator color={theme.ACCENT} style={{ marginTop: 40 }} />
          : (
            <FlatList
              data={filtered}
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
                    <Text style={s.cardArtist} numberOfLines={1}>{item.artist}</Text>
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
})
