import React, { useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, FlatList, useWindowDimensions,
} from 'react-native'
import { useRoute, RouteProp } from '@react-navigation/native'

import { theme } from '../constants/theme'
import { useTracks } from '../context/TrackContext'
import FFTBar from '../components/FFTBar'
import { Track, fetchAnalysis } from '../data/api'
import { LibraryStackParamList } from '../types/navigation'

type RouteP = RouteProp<LibraryStackParamList, 'Compare'>

export default function CompareScreen() {
  const { width } = useWindowDimensions()
  const route     = useRoute<RouteP>()
  const { tracks, setTracks } = useTracks()

  const trackA = tracks.find(t => t.id === route.params.trackId) ?? null

  // Store only the ID so trackB re-derives from the live tracks array on every render.
  // This means any setTracks() call (e.g. from analysis fetch below) is reflected instantly.
  const [trackBId,   setTrackBId]   = useState<number | null>(null)
  const [isLoadingB, setIsLoadingB] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const trackB: Track | null = trackBId != null
    ? (tracks.find(t => t.id === trackBId) ?? null)
    : null

  // When the user picks Track B, immediately fetch its analysis so BPM/Key populate.
  // Uses the same setTracks pattern as TrackDetailScreen so the data is shared globally.
  async function handleSelectTrackB(track: Track) {
    setTrackBId(track.id)
    setShowPicker(false)
    if (typeof track.bpm === 'number') return   // already have analysis from a prior detail view
    setIsLoadingB(true)
    try {
      const a = await fetchAnalysis(track.id)
      if (a && Object.keys(a).length > 0) {
        const bpmNum = typeof a.bpm === 'number' ? Math.round(a.bpm) : null
        const kp = a.key ?? ''; const sp = a.scale ?? ''
        const keyVal = [kp, sp].filter(Boolean).join(' ') || '—'
        setTracks(prev => prev.map(t =>
          t.id === track.id
            ? { ...t, bpm: bpmNum ?? t.bpm, key: keyVal, status: 'analyzed' }
            : t
        ))
      }
    } catch {}
    finally { setIsLoadingB(false) }
  }

  const vizW = width - 32

  // ── Similarity analysis ───────────────────────────────────────────────

  const bpmA = typeof trackA?.bpm === 'number' ? trackA.bpm : null
  const bpmB = typeof trackB?.bpm === 'number' ? trackB.bpm : null
  const bpmDiff = bpmA !== null && bpmB !== null ? Math.abs(bpmA - bpmB) : null

  const rootA = trackA?.key.split(' ')[0]?.toLowerCase() ?? ''
  const rootB = trackB?.key.split(' ')[0]?.toLowerCase() ?? ''

  const notes: string[] = []
  if (bpmDiff === 0) notes.push('Identical BPM')
  else if (bpmDiff !== null && bpmDiff <= 5) notes.push(`BPM within ±${bpmDiff}`)
  if (trackA?.key === trackB?.key && trackA?.key !== '—') notes.push('Same key — perfect mix!')
  else if (rootA && rootB && rootA === rootB) notes.push('Compatible key (same root)')

  return (
    <ScrollView style={s.sv} contentContainerStyle={s.content}>
      <Text style={s.pageTitle}>Compare Tracks</Text>

      {/* Track A */}
      <Text style={[s.trackLbl, { color: theme.ACCENT }]}>Track A</Text>
      <Text style={s.trackName}>{trackA?.title ?? '—'} — {trackA?.artist ?? '—'}</Text>
      <Text style={s.specLbl}>Frequency Spectrum</Text>
      <FFTBar seed={trackA?.id ?? 1} width={vizW} height={64} color={theme.ACCENT} />

      {/* Similarity badge */}
      {trackB && (
        <View style={[s.simBox, notes.length > 0 && s.simBoxGreen]}>
          <Text style={[s.simTxt, notes.length > 0 && { color: theme.SUCCESS }]}>
            {notes.length > 0 ? '✓ ' + notes.join('  ·  ') : 'Different BPM and key'}
          </Text>
        </View>
      )}

      {/* Stats comparison */}
      {trackB && (
        <View style={s.statsRow}>
          {[
            { label: 'BPM (A)',  value: String(trackA?.bpm ?? '—'), color: theme.ACCENT },
            { label: 'BPM (B)',  value: isLoadingB ? '…' : String(trackB.bpm ?? '—'), color: theme.INFO   },
            { label: 'Key (A)',  value: trackA?.key ?? '—',                            color: theme.ACCENT },
            { label: 'Key (B)',  value: isLoadingB ? '…' : (trackB.key  ?? '—'),       color: theme.INFO   },
          ].map(st => (
            <View key={st.label} style={s.statBox}>
              <Text style={[s.statVal, { color: st.color }]} numberOfLines={1} adjustsFontSizeToFit>{st.value}</Text>
              <Text style={s.statLbl}>{st.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Track B */}
      {trackB && (
        <>
          <Text style={[s.trackLbl, { color: theme.INFO, marginTop: 14 }]}>Track B</Text>
          <Text style={s.trackName}>{trackB.title} — {trackB.artist}</Text>
          <Text style={s.specLbl}>Frequency Spectrum</Text>
          <FFTBar seed={trackB.id} width={vizW} height={64} color={theme.INFO} />
        </>
      )}

      {/* Select B button */}
      <TouchableOpacity style={s.selectBtn} onPress={() => setShowPicker(true)}>
        <Text style={s.selectBtnTxt}>
          {trackB ? 'Change Track B →' : 'Select Track B to compare →'}
        </Text>
      </TouchableOpacity>

      {/* Track picker modal */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <View style={s.overlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Select Track B</Text>
            <FlatList
              data={tracks.filter(t => t.id !== trackA?.id)}
              keyExtractor={t => String(t.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={s.sheetItem}
                  onPress={() => handleSelectTrackB(item)}>
                  <Text style={s.sheetItemTitle}>{item.title}</Text>
                  <Text style={s.sheetItemSub}>{item.artist} · {item.bpm} BPM · {item.key}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={s.empty}>No other tracks to compare</Text>}
            />
            <TouchableOpacity style={s.cancelBtn} onPress={() => setShowPicker(false)}>
              <Text style={{ color: theme.ACCENT, fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  sv:         { flex: 1, backgroundColor: theme.BG_PRIMARY },
  content:    { padding: 16, paddingBottom: 40 },
  pageTitle:  { color: theme.TEXT_PRIMARY, fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  trackLbl:   { fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  trackName:  { color: theme.TEXT_PRIMARY, fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  specLbl:    { color: theme.TEXT_TERTIARY, fontSize: 10, marginBottom: 6 },
  simBox:     { backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_MD, padding: 10, marginVertical: 10, alignItems: 'center' },
  simBoxGreen:{ borderWidth: 1, borderColor: theme.SUCCESS },
  simTxt:     { color: theme.TEXT_TERTIARY, fontSize: 12 },
  statsRow:   { flexDirection: 'row', gap: 6, marginBottom: 8 },
  statBox:    { flex: 1, backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_SM, padding: 6, alignItems: 'center' },
  statVal:    { fontSize: 14, fontWeight: 'bold' },
  statLbl:    { color: theme.TEXT_TERTIARY, fontSize: 9, marginTop: 1 },
  selectBtn:  { backgroundColor: 'rgba(100,210,255,0.1)', borderWidth: 1, borderColor: theme.INFO, borderRadius: theme.RADIUS_MD, height: 40, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  selectBtnTxt: { color: theme.INFO, fontSize: 13 },
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: theme.BG_SECONDARY, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '70%' },
  sheetTitle: { color: theme.TEXT_PRIMARY, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  sheetItem:  { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.BORDER },
  sheetItemTitle: { color: theme.TEXT_PRIMARY, fontSize: 13, fontWeight: 'bold' },
  sheetItemSub:   { color: theme.TEXT_SECONDARY, fontSize: 11, marginTop: 2 },
  cancelBtn:  { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  empty:      { color: theme.TEXT_TERTIARY, fontSize: 13, padding: 16, textAlign: 'center' },
})
