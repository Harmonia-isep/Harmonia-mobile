import React, { useState, useEffect, useLayoutEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, useWindowDimensions,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { theme } from '../constants/theme'
import { useTracks } from '../context/TrackContext'
import { fetchAnalysis, deleteTrack } from '../data/api'
import WaveformBar from '../components/WaveformBar'
import FFTBar from '../components/FFTBar'
import { LibraryStackParamList } from '../types/navigation'

type RouteP = RouteProp<LibraryStackParamList, 'TrackDetail'>
type NavP   = NativeStackNavigationProp<LibraryStackParamList, 'TrackDetail'>

export default function TrackDetailScreen() {
  const { width }  = useWindowDimensions()
  const route      = useRoute<RouteP>()
  const nav        = useNavigation<NavP>()
  const { tracks, setTracks } = useTracks()

  const track = tracks.find(t => t.id === route.params.trackId)

  const [bpm,           setBpm]           = useState('—')
  const [key,           setKey]           = useState('—')
  const [status,        setStatus]        = useState('—')
  const [magnitudes,    setMagnitudes]    = useState<number[] | null>(null)
  const [isLoading,     setIsLoading]     = useState(true)
  const [hasError,      setHasError]      = useState(false)
  const [showSimilar,   setShowSimilar]   = useState(false)
  const [analysisReady, setAnalysisReady] = useState(false)
  const [retryCount,    setRetryCount]    = useState(0)
  const MAX_RETRIES = 20   // ~60 s of polling before giving up

  useLayoutEffect(() => {
    nav.setOptions({ title: track?.title ?? 'Track Detail' })
  }, [track?.title])

  // Reset state and kick off the first analysis fetch whenever the track changes
  useEffect(() => {
    if (!track) return
    setAnalysisReady(false)
    setRetryCount(0)
    setBpm(String(track.bpm))
    setKey(track.key)
    setStatus(track.status
      ? track.status.charAt(0).toUpperCase() + track.status.slice(1)
      : '—')
    loadAnalysis(track.id)
  }, [track?.id])

  // Poll every 3 s while analysis hasn't arrived yet (backend job is async)
  useEffect(() => {
    if (analysisReady || !track || retryCount === 0 || retryCount > MAX_RETRIES) return
    const timer = setTimeout(() => loadAnalysis(track.id), 3000)
    return () => clearTimeout(timer)
  }, [retryCount, analysisReady, track?.id])

  // ── UC02: fetch analysis ──────────────────────────────────────────────

  async function loadAnalysis(trackId: number) {
    setIsLoading(true)
    setHasError(false)
    try {
      const a = await fetchAnalysis(trackId)
      if (a && Object.keys(a).length > 0) {
        const bpmNum = typeof a.bpm === 'number' ? Math.round(a.bpm) : null
        const kp = a.key ?? ''; const sp = a.scale ?? ''
        const keyVal = [kp, sp].filter(Boolean).join(' ') || '—'
        if (bpmNum != null) setBpm(String(bpmNum))
        setKey(keyVal)
        setStatus('Analyzed')
        setAnalysisReady(true)
        const mags = a.fft_magnitudes ?? a.fft_data ?? a.spectrum
        if (Array.isArray(mags)) setMagnitudes(mags)
        // Propagate bpm + key back into the global list so the library badge updates too
        setTracks(prev => prev.map(t =>
          t.id === trackId
            ? { ...t, bpm: bpmNum ?? t.bpm, key: keyVal, status: 'analyzed' }
            : t
        ))
      } else {
        // Backend job not finished yet — polling effect will retry after 3 s
        setRetryCount(n => n + 1)
      }
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }

  // ── UC05: delete ──────────────────────────────────────────────────────

  function handleDelete() {
    if (!track) return
    Alert.alert('Delete Track', `Delete "${track.title}"?\nThis cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const ok = await deleteTrack(track.id)
          if (ok) {
            setTracks(prev => prev.filter(t => t.id !== track.id))
            nav.goBack()
          } else {
            Alert.alert('Error', 'Could not delete the track.')
          }
        },
      },
    ])
  }

  // ── UC07: similar tracks ──────────────────────────────────────────────

  const similar = track ? tracks.filter(t => {
    if (t.id === track.id) return false
    const myBpm = typeof track.bpm === 'number' ? track.bpm : null
    const tBpm  = typeof t.bpm  === 'number' ? t.bpm  : null
    const bpmOk = myBpm !== null && tBpm !== null && Math.abs(myBpm - tBpm) <= 5
    const myRoot = track.key.split(' ')[0]?.toLowerCase() ?? ''
    const tRoot  = t.key.split(' ')[0]?.toLowerCase() ?? ''
    const keyOk  = Boolean(myRoot && tRoot && myRoot === tRoot)
    return bpmOk || keyOk
  }).sort((a, b) => {
    const myBpm = typeof track.bpm === 'number' ? track.bpm : 0
    return (typeof a.bpm === 'number' ? Math.abs(myBpm - a.bpm) : 999)
         - (typeof b.bpm === 'number' ? Math.abs(myBpm - b.bpm) : 999)
  }).slice(0, 5) : []

  const vizW = width - 32

  if (!track) {
    return (
      <View style={s.center}>
        <Text style={{ color: theme.TEXT_SECONDARY }}>Track not found.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={s.sv} contentContainerStyle={s.content}>

      {/* Album art placeholder */}
      <View style={s.art}>
        <Ionicons name="musical-note" size={64} color={theme.TEXT_TERTIARY} />
      </View>

      <Text style={s.trackTitle}>{track.title}</Text>
      <Text style={s.trackArtist}>{track.artist}</Text>
      <View style={s.durationRow}>
        <Ionicons name="time-outline" size={12} color={theme.TEXT_TERTIARY} />
        <Text style={s.trackDuration}> {track.duration}</Text>
      </View>

      {/* Stats */}
      <View style={s.statsRow}>
        {[
          { label: 'BPM',    value: bpm,    color: theme.INFO    },
          { label: 'Key',    value: key,    color: theme.SUCCESS },
          {
            label: 'Status',
            value: (!analysisReady && retryCount > 0 && retryCount <= MAX_RETRIES)
              ? 'Analyzing…'
              : status,
            color: theme.WARNING,
          },
        ].map(st => (
          <View key={st.label} style={s.statBox}>
            <Text style={[s.statVal, { color: st.color }]} numberOfLines={1} adjustsFontSizeToFit>{st.value}</Text>
            <Text style={s.statLbl}>{st.label}</Text>
          </View>
        ))}
      </View>

      {isLoading && <ActivityIndicator color={theme.ACCENT} style={{ marginVertical: 8 }} />}
      {hasError && (
        <View style={s.errBox}>
          <Ionicons name="warning-outline" size={14} color={theme.ERROR} style={{ marginRight: 6 }} />
          <Text style={s.errTxt}>Could not load analysis</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => loadAnalysis(track.id)}>
            <Text style={s.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* UC02: Waveform */}
      <Text style={s.secLbl}>Waveform</Text>
      <WaveformBar seed={track.id} width={vizW} height={72} />

      {/* UC02: FFT spectrum */}
      <Text style={[s.secLbl, { marginTop: 10 }]}>Frequency Spectrum</Text>
      <FFTBar seed={track.id} width={vizW} height={64} magnitudes={magnitudes ?? undefined} />

      {/* Action buttons */}
      <View style={s.actions}>
        <ActionBtn iconName="trash-outline"           label="Delete"  color={theme.ERROR}   onPress={handleDelete} />
        <ActionBtn iconName="swap-horizontal-outline" label="Compare" color={theme.INFO}    onPress={() => nav.navigate('Compare', { trackId: track.id })} />
        <ActionBtn iconName="musical-notes-outline"   label="Similar" color={theme.SUCCESS} onPress={() => setShowSimilar(!showSimilar)} />
      </View>

      {/* UC07: Recommendations */}
      {showSimilar && (
        <View style={s.recoBox}>
          <Text style={s.recoHdr}>Similar tracks ({similar.length})</Text>
          {similar.length === 0
            ? <Text style={s.recoEmpty}>No similar tracks in your library</Text>
            : similar.map(t => (
                <TouchableOpacity key={t.id} style={s.recoRow}
                  onPress={() => nav.push('TrackDetail', { trackId: t.id })}>
                  <Text style={s.recoName} numberOfLines={1}>{t.title} — {t.artist}</Text>
                  <Text style={s.recoMeta}>{t.bpm} BPM · {t.key}</Text>
                </TouchableOpacity>
              ))
          }
        </View>
      )}
    </ScrollView>
  )
}

function ActionBtn({ iconName, label, color, onPress }: {
  iconName: string; label: string; color: string; onPress: () => void
}) {
  return (
    <TouchableOpacity style={[s.actBtn, { borderColor: color }]} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={iconName as any} size={14} color={color} />
      <Text style={[s.actBtnTxt, { color, marginLeft: 4 }]}>{label}</Text>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  sv:     { flex: 1, backgroundColor: theme.BG_PRIMARY },
  content:{ padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: theme.BG_PRIMARY, justifyContent: 'center', alignItems: 'center' },
  art: {
    backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_LG,
    height: 140, justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  trackTitle:    { color: theme.TEXT_PRIMARY, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  trackArtist:   { color: theme.TEXT_SECONDARY, fontSize: 13, textAlign: 'center', marginBottom: 2 },
  durationRow:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  trackDuration: { color: theme.TEXT_TERTIARY, fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statBox:  { flex: 1, backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_MD, padding: 8, alignItems: 'center' },
  statVal:  { fontSize: 17, fontWeight: 'bold' },
  statLbl:  { color: theme.TEXT_TERTIARY, fontSize: 10, marginTop: 2 },
  secLbl:   { color: theme.TEXT_TERTIARY, fontSize: 11, marginBottom: 6 },
  errBox:   { flexDirection: 'row', backgroundColor: 'rgba(255,69,58,0.08)', borderRadius: theme.RADIUS_SM, padding: 10, alignItems: 'center', marginBottom: 8 },
  errTxt:   { color: theme.ERROR, fontSize: 12, flex: 1 },
  retryBtn: { backgroundColor: theme.ACCENT, borderRadius: theme.RADIUS_SM, paddingHorizontal: 10, paddingVertical: 4 },
  retryTxt: { color: theme.TEXT_PRIMARY, fontSize: 11 },
  actions:  { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 8 },
  actBtn:   { flex: 1, height: 36, borderWidth: 1, borderRadius: theme.RADIUS_SM, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
  actBtnTxt:{ fontSize: 12 },
  recoBox:  { backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_MD, padding: 10, marginTop: 6 },
  recoHdr:  { color: theme.TEXT_SECONDARY, fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  recoEmpty:{ color: theme.TEXT_TERTIARY, fontSize: 12 },
  recoRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  recoName: { color: theme.TEXT_PRIMARY, fontSize: 12, flex: 1, marginRight: 8 },
  recoMeta: { color: theme.INFO, fontSize: 11 },
})
