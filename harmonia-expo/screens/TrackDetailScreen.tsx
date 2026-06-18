import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet,
  Alert, ActivityIndicator, useWindowDimensions, GestureResponderEvent, Platform,
} from 'react-native'
import Svg, { Rect } from 'react-native-svg'
import { Ionicons } from '@expo/vector-icons'
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { theme } from '../constants/theme'
import { useTracks } from '../context/TrackContext'
import { Audio } from 'expo-av'
import { fetchAnalysis, triggerAnalysis, deleteTrack, getAudioUrl, Track } from '../data/api'
import { removeTrackFromAllPlaylists } from '../data/storage'
import { useAuth } from '../context/AuthContext'
import FFTBar from '../components/FFTBar'
import { LibraryStackParamList } from '../types/navigation'

type RouteP = RouteProp<LibraryStackParamList, 'TrackDetail'>
type NavP   = NativeStackNavigationProp<LibraryStackParamList, 'TrackDetail'>

// Web-style waveform: a fixed set of thin vertical bars. Real PCM peaks aren't
// available on-device (the web decodes audio via Web Audio API, which RN lacks,
// and the backend serves no peak array), so heights are derived deterministically
// from the track id — stable per track — and the bars react to playback position.
const WAVE_BARS = 56
const WAVE_H    = 56
const BAR_GAP   = 2

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
}

function fmtTime(ms: number): string {
  if (!ms || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Resolves the network URL that expo-av should stream. Returns null when no valid
// source can be built so callers can disable playback instead of feeding the Sound
// player an empty/garbage URI (which surfaces as "no supported source was found").
//
// The backend exposes raw audio ONLY via GET /api/tracks/{id}/audio — there is no
// static /uploads mount — so the id route is the source for every track, exactly
// how the web app builds its <audio> src (api.js: `${BASE}/api/tracks/${id}/audio`).
// A relative file_path (e.g. the 'uploads/<uuid>.mp3' returned right after an upload)
// is NOT directly fetchable and would 404, so we only honour file_path when it's
// already an absolute http(s) URL.
// Normalize a candidate stream URL: convert Windows-style backslashes to forward
// slashes and collapse accidental duplicate slashes in the path portion while
// preserving the '://' scheme separator. Applied to EVERY resolved URL so the
// browser always receives a clean source string.
function sanitizeStreamUrl(url: string): string {
  return url
    .trim()
    .replace(/\\/g, '/')           // backslashes → forward slashes (global)
    .replace(/([^:]\/)\/+/g, '$1') // squash duplicate slashes, keep '://'
}

function resolveAudioUrl(track: Track | undefined): string | null {
  if (!track || track.id == null) return null

  const fp = track.file_path ? sanitizeStreamUrl(track.file_path) : undefined

  if (fp && /^https?:\/\//i.test(fp)) return fp   // already absolute → stream directly

  return sanitizeStreamUrl(getAudioUrl(track.id)) // canonical, web-matching route
}

export default function TrackDetailScreen() {
  const { width }  = useWindowDimensions()
  const route      = useRoute<RouteP>()
  const nav        = useNavigation<NavP>()
  const { tracks, setTracks } = useTracks()
  const { user } = useAuth()

  const track = tracks.find(t => t.id === route.params.trackId)

  const [bpm,           setBpm]           = useState('—')
  const [key,           setKey]           = useState('—')
  const [energy,        setEnergy]        = useState('—')
  const [danceability,  setDanceability]  = useState('—')
  const [status,        setStatus]        = useState('—')
  const [magnitudes,    setMagnitudes]    = useState<number[] | null>(null)
  const [isLoading,     setIsLoading]     = useState(true)
  const [hasError,      setHasError]      = useState(false)
  const [showSimilar,   setShowSimilar]   = useState(false)
  const [analysisReady, setAnalysisReady] = useState(false)
  const [pollExhausted, setPollExhausted] = useState(false)
  const [retryTrigger,  setRetryTrigger]  = useState(0)

  // ── Audio playback ────────────────────────────────────────────────────
  const soundRef         = useRef<Audio.Sound | null>(null)
  // Web uses a plain HTML5 <audio> element instead of expo-av: native browser
  // streaming has no expo-av header/blob-fetch quirks and decodes the stream directly.
  const webAudioRef      = useRef<HTMLAudioElement | null>(null)
  // Listeners attached to the current web <audio> element, kept so teardown can
  // detach every one of them — leaving them attached leaks the element and lets a
  // stale instance fire setState (and the error alert) after the screen is gone.
  const webHandlersRef   = useRef<Array<[string, EventListener]> | null>(null)
  const [isPlaying,      setIsPlaying]      = useState(false)
  const [isAudioLoading, setIsAudioLoading] = useState(false)
  const [positionMillis, setPositionMillis] = useState(0)
  const [durationMillis, setDurationMillis] = useState(0)

  // Polling is driven by a setInterval stored in a ref, not by React state.
  // This makes it immune to re-renders and keeps the loop alive through transient errors.
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)
  const MAX_POLLS = 10    // 10 × 4 s = 40 s of background polling after the first fetch
  const POLL_MS   = 4000

  // Tears down the interval without touching React state — safe to call from cleanup.
  function clearPoll() {
    if (pollRef.current != null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useLayoutEffect(() => {
    nav.setOptions({ title: track?.title ?? 'Track Detail' })
  }, [track?.title])

  // Kick off an immediate fetch + start the background polling interval.
  // Cleans up the interval when the user navigates away or views a different track.
  useEffect(() => {
    if (!track) return

    setAnalysisReady(false)
    setPollExhausted(false)
    pollCountRef.current = 0
    setBpm(String(track.bpm))
    setKey(track.key)
    setEnergy('—')
    setDanceability('—')
    setStatus(track.status
      ? track.status.charAt(0).toUpperCase() + track.status.slice(1)
      : '—')

    loadAnalysis(track.id, true)   // first load shows the spinner

    pollRef.current = setInterval(() => {
      pollCountRef.current += 1
      if (pollCountRef.current >= MAX_POLLS) {
        clearPoll()
        setPollExhausted(true)
        return
      }
      loadAnalysis(track.id)       // subsequent polls are silent (no spinner)
    }, POLL_MS)

    return clearPoll   // stop the interval when unmounting or navigating away
  }, [track?.id, retryTrigger])

  // Fully unload + null the native expo-av Sound. Safe to call repeatedly.
  function teardownNativeSound() {
    const s = soundRef.current
    if (!s) return
    soundRef.current = null   // null FIRST so async status callbacks bail out
    s.stopAsync().catch(() => {})
    s.unloadAsync().catch(() => {})
  }

  // Fully tear down the web <audio> element: detach every listener, abort the
  // load, and null the ref. Listeners are removed BEFORE clearing the source so
  // the abort never re-enters reportWebAudioError with a spurious "Playback Error"
  // (an empty/removed src otherwise fires MEDIA_ERR_SRC_NOT_SUPPORTED).
  function teardownWebAudio() {
    const wa = webAudioRef.current
    if (!wa) return
    webAudioRef.current = null   // null FIRST so any in-flight handler short-circuits
    ;(wa as any).__tearingDown = true
    if (webHandlersRef.current) {
      for (const [evt, fn] of webHandlersRef.current) wa.removeEventListener(evt, fn)
      webHandlersRef.current = null
    }
    try {
      wa.pause()
      wa.removeAttribute('src')  // detach source so the browser releases the stream
      wa.load()                  // abort the pending network request cleanly
    } catch {}
  }

  // Reset all playback UI back to initial values so stale position/duration from a
  // previous track never bleeds into a freshly opened one.
  function resetPlaybackUi() {
    setIsPlaying(false)
    setIsAudioLoading(false)
    setPositionMillis(0)
    setDurationMillis(0)
  }

  // Stop and release audio whenever the user navigates to a different track or leaves the screen.
  useEffect(() => {
    return () => {
      teardownNativeSound()
      teardownWebAudio()
      resetPlaybackUi()
    }
  }, [track?.id])

  // ── UC02: fetch analysis ──────────────────────────────────────────────

  async function loadAnalysis(trackId: number, showSpinner = false) {
    if (showSpinner) { setIsLoading(true); setHasError(false) }
    try {
      const a = await fetchAnalysis(trackId)
      if (a && Object.keys(a).length > 0) {
        clearPoll()   // got the data — stop all further polling
        const bpmNum = typeof a.bpm === 'number' ? Math.round(a.bpm) : null
        const kp = a.key ?? ''; const sp = a.scale ?? ''
        const keyVal = [kp, sp].filter(Boolean).join(' ') || '—'
        if (bpmNum != null) setBpm(String(bpmNum))
        setKey(keyVal)
        if (a.energy      != null) setEnergy(`${(Number(a.energy)      * 100).toFixed(1)}%`)
        if (a.danceability != null) setDanceability(`${(Number(a.danceability) * 100).toFixed(1)}%`)
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
      }
      // Empty result (404 / not ready): interval keeps firing until data arrives or MAX_POLLS
    } catch {
      // Swallow transient errors (503 cold-start, network blip) so the polling loop
      // survives and retries on the next tick instead of dying permanently.
    } finally {
      if (showSpinner) setIsLoading(false)
    }
  }

  // Re-trigger the backend analysis job then restart the polling loop.
  // Called when the user taps "Retry" after poll exhaustion.
  async function retryAnalysis() {
    if (!track) return
    try { await triggerAnalysis(track.id) } catch {}
    setRetryTrigger(n => n + 1)  // causes the setup useEffect to re-run cleanly
  }

  // ── Audio: stream and toggle playback ────────────────────────────────

  async function togglePlayback() {
    if (!track) return
    const streamUrl = resolveAudioUrl(track)
    if (!streamUrl) {
      console.warn('[Harmonia] No audio source for track', track?.id)
      return
    }

    // Exact link structure being handed to the media engine — inspect in the terminal/console.
    console.log('[Harmonia Debug] Absolute Web Stream URI:', streamUrl)

    // Web target: drive a native HTML5 <audio> element directly (bulletproof,
    // bypasses expo-av's web shim entirely).
    if (Platform.OS === 'web') {
      await toggleWebPlayback(streamUrl)
      return
    }

    // If a sound is already loaded, toggle play / pause without re-fetching.
    if (soundRef.current) {
      try {
        const status = await soundRef.current.getStatusAsync()
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync()
            setIsPlaying(false)
          } else {
            await soundRef.current.playAsync()
            setIsPlaying(true)
          }
          return
        }
      } catch {}
      // Sound object in a bad state — unload and fall through to re-create.
      await soundRef.current.unloadAsync().catch(() => {})
      soundRef.current = null
    }

    // First tap: configure the audio session, then stream and play.
    setIsAudioLoading(true)
    try {
      // setAudioModeAsync targets the native iOS/Android audio session; several of
      // its keys throw "not supported" on web, so skip it there entirely.
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true })
      const { sound, status } = await Audio.Sound.createAsync(
        // `Accept` is a CORS-safelisted header (no preflight); the backend already
        // sends Access-Control-Allow-Origin: * so cross-origin media playback is allowed.
        { uri: streamUrl, headers: { Accept: 'audio/*,*/*;q=0.9' } },
        { shouldPlay: true, progressUpdateIntervalMillis: 200 },
        (st) => {
          if (!st.isLoaded) return
          setIsPlaying(st.isPlaying ?? false)
          setPositionMillis(st.positionMillis ?? 0)
          // On web the duration arrives once the <audio> element loads metadata —
          // keep picking it up on every status tick until it's a real value.
          if (st.durationMillis != null && st.durationMillis > 0) {
            setDurationMillis(st.durationMillis)
          }
          // Reset to the start when the track finishes so it can be replayed.
          if (st.didJustFinish) {
            setIsPlaying(false)
            setPositionMillis(0)
            soundRef.current?.setPositionAsync(0).catch(() => {})
          }
        }
      )
      soundRef.current = sound
      // Seed the duration straight from the initial load status when available.
      if (status.isLoaded && status.durationMillis != null && status.durationMillis > 0) {
        setDurationMillis(status.durationMillis)
      }
      setIsPlaying(true)
    } catch (e: any) {
      // Native only — the web target returned early to toggleWebPlayback() above.
      console.error('[Harmonia] Native audio playback failed:', e)
      Alert.alert('Playback Error', e?.message ?? 'Could not play this track.')
      setIsPlaying(false)
    } finally {
      setIsAudioLoading(false)
    }
  }

  // ── Web playback via a native HTML5 <audio> element ───────────────────
  // No expo-av on web: a plain Audio element streams the URL directly with no
  // header/blob-fetch quirks. crossOrigin is intentionally NOT set — it isn't
  // needed for playback and would only add a CORS gate that can break it.
  async function toggleWebPlayback(url: string) {
    const existing = webAudioRef.current
    if (existing) {
      if (!existing.paused) {
        existing.pause()
        setIsPlaying(false)
      } else {
        try { await existing.play(); setIsPlaying(true) }
        catch (e) { reportWebAudioError(e, existing) }
      }
      return
    }

    // Defensive: ensure no previous element lingers before we build a fresh one.
    teardownWebAudio()
    // Clear any stale position/duration so the timestamp starts clean for this track.
    setPositionMillis(0)
    setDurationMillis(0)
    setIsAudioLoading(true)
    // window.Audio — the browser's HTMLAudioElement constructor. (`Audio` alone
    // resolves to the expo-av import in this module.)
    const audio = new window.Audio(url)
    audio.preload = 'auto'
    webAudioRef.current = audio

    // Register every listener through a ref-tracked helper so teardownWebAudio()
    // can detach all of them — preventing leaks and post-unmount setState.
    const handlers: Array<[string, EventListener]> = []
    const on = (evt: string, fn: EventListener) => {
      handlers.push([evt, fn])
      audio.addEventListener(evt, fn)
    }
    webHandlersRef.current = handlers

    // Real duration becomes known once metadata loads → label flips from — to e.g. 3:11.
    const syncDuration = () => { if (isFinite(audio.duration)) setDurationMillis(audio.duration * 1000) }
    on('loadedmetadata', syncDuration)
    on('durationchange', syncDuration)
    on('timeupdate', () => setPositionMillis(audio.currentTime * 1000))
    on('playing', () => { setIsPlaying(true); setIsAudioLoading(false) })
    on('pause',   () => setIsPlaying(false))
    on('ended', () => {
      setIsPlaying(false)
      setPositionMillis(0)
      if (webAudioRef.current) webAudioRef.current.currentTime = 0
    })
    // Fires when the source 404s or can't be decoded — translate the cryptic
    // NotSupportedError into something actionable.
    on('error', () => reportWebAudioError(audio.error, audio))

    try {
      await audio.play()
      setIsPlaying(true)
    } catch (e) {
      reportWebAudioError(e, audio)
    } finally {
      setIsAudioLoading(false)
    }
  }

  function reportWebAudioError(err: unknown, audio: HTMLAudioElement) {
    // Ignore errors raised while the element is being torn down (navigating away /
    // switching tracks): those are not real playback failures, just the abort.
    if ((audio as any).__tearingDown) return
    setIsAudioLoading(false)
    setIsPlaying(false)
    const code = audio.error?.code
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) / MEDIA_ERR_NETWORK (2): the server returned
    // no playable audio — here the file is missing from the backend (404 JSON body).
    const fileMissing = code === 4 || code === 2
    console.error('[Harmonia] Web audio error:', { code, mediaError: audio.error, err })
    window.alert(
      fileMissing
        ? 'Playback Error\nThis track’s audio file is not available on the server '
          + '(it was likely removed by a backend restart). Re-upload the track to play it.'
        : 'Playback Error\nThe browser could not load this audio stream.'
    )
  }

  // Tap anywhere on the waveform to scrub. If audio isn't loaded yet, start playback.
  async function handleSeek(evt: GestureResponderEvent) {
    const pct = Math.max(0, Math.min(1, evt.nativeEvent.locationX / waveW))

    if (Platform.OS === 'web') {
      const audio = webAudioRef.current
      if (!audio || !isFinite(audio.duration) || audio.duration <= 0) { togglePlayback(); return }
      audio.currentTime = pct * audio.duration
      setPositionMillis(audio.currentTime * 1000)
      return
    }

    if (!soundRef.current || durationMillis <= 0) { togglePlayback(); return }
    const pos = pct * durationMillis
    setPositionMillis(pos)
    await soundRef.current.setPositionAsync(pos).catch(() => {})
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
            if (user) await removeTrackFromAllPlaylists(user.id, track.id)
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
    const keyOk  = Boolean(myRoot && tRoot && myRoot === tRoot && myRoot !== '—')
    return bpmOk || keyOk
  }).sort((a, b) => {
    const myBpm = typeof track.bpm === 'number' ? track.bpm : 0
    return (typeof a.bpm === 'number' ? Math.abs(myBpm - a.bpm) : 999)
         - (typeof b.bpm === 'number' ? Math.abs(myBpm - b.bpm) : 999)
  }).slice(0, 5) : []

  const vizW = width - 32

  // Resolved once for the render: drives both playback and the play-button enabled state.
  const audioUrl = resolveAudioUrl(track)

  // Waveform geometry + per-track deterministic bar heights.
  const waveW = vizW - 24   // minus the player card's horizontal padding
  const barW  = Math.max(1, (waveW - (WAVE_BARS - 1) * BAR_GAP) / WAVE_BARS)
  const playedBars = durationMillis > 0
    ? Math.round((positionMillis / durationMillis) * WAVE_BARS)
    : 0
  const totalLabel = durationMillis > 0 ? fmtTime(durationMillis) : (track?.duration || '0:00')

  const peaks = useMemo(() => {
    const rng = seededRng((track?.id ?? 1) + 7)
    return Array.from({ length: WAVE_BARS }, (_, i) => {
      // arch envelope (louder middle) so it reads like a song, not noise
      const env = 0.35 + 0.65 * Math.sin((i / (WAVE_BARS - 1)) * Math.PI)
      return Math.max(0.1, rng() * env)
    })
  }, [track?.id])

  if (!track) {
    return (
      <View style={s.center}>
        <Text style={{ color: theme.TEXT_SECONDARY }}>Track not found.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={s.sv} contentContainerStyle={s.content}>

      {/* Audio player — mirrors the web: red play/pause button + timestamp,
          with a tappable waveform that highlights as the track plays. */}
      <View style={s.player}>
        <View style={s.playerControls}>
          <TouchableOpacity
            style={[s.playBtn, !audioUrl && { opacity: 0.4 }]}
            onPress={togglePlayback}
            disabled={isAudioLoading || !audioUrl}
            activeOpacity={0.8}
          >
            {isAudioLoading
              ? <ActivityIndicator color={theme.TEXT_PRIMARY} />
              : <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={20}
                  color={theme.TEXT_PRIMARY}
                  style={!isPlaying ? { marginLeft: 2 } : undefined}
                />
            }
          </TouchableOpacity>
          <Text style={s.playerTime}>{fmtTime(positionMillis)} / {totalLabel}</Text>
        </View>

        <Pressable onPress={handleSeek}>
          <Svg width={waveW} height={WAVE_H}>
            {peaks.map((p, i) => {
              const bh = Math.max(2, p * (WAVE_H - 8))
              const x  = i * (barW + BAR_GAP)
              const y  = (WAVE_H - bh) / 2
              const played = i < playedBars
              return (
                <Rect
                  key={i} x={x} y={y} width={barW} height={bh} rx={1}
                  fill={played ? theme.ACCENT : 'rgba(255,59,48,0.28)'}
                />
              )
            })}
          </Svg>
        </Pressable>
      </View>

      <Text style={s.trackTitle}>{track.title}</Text>
      <Text style={s.trackArtist}>
        {track.artist}{track.album ? ` · ${track.album}` : ''}
      </Text>
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
            value: analysisReady ? 'Analyzed'
              : pollExhausted  ? '—'
              : 'Analyzing…',
            color: theme.WARNING,
          },
        ].map(st => (
          <View key={st.label} style={s.statBox}>
            <Text style={[s.statVal, { color: st.color }]} numberOfLines={1} adjustsFontSizeToFit>{st.value}</Text>
            <Text style={s.statLbl}>{st.label}</Text>
          </View>
        ))}
      </View>

      {/* Energy + Danceability — shown once analysis has arrived */}
      {analysisReady && (
        <View style={[s.statsRow, { marginTop: 0 }]}>
          {[
            { label: 'Energy',       value: energy,       color: theme.ACCENT },
            { label: 'Danceability', value: danceability, color: theme.SUCCESS },
          ].map(st => (
            <View key={st.label} style={s.statBox}>
              <Text style={[s.statVal, { color: st.color }]} numberOfLines={1} adjustsFontSizeToFit>{st.value}</Text>
              <Text style={s.statLbl}>{st.label}</Text>
            </View>
          ))}
        </View>
      )}

      {isLoading && <ActivityIndicator color={theme.ACCENT} style={{ marginVertical: 8 }} />}
      {pollExhausted && !analysisReady && (
        <View style={s.errBox}>
          <Ionicons name="warning-outline" size={14} color={theme.WARNING} style={{ marginRight: 6 }} />
          <Text style={s.errTxt}>Analysis is taking longer than expected</Text>
          <TouchableOpacity style={s.retryBtn} onPress={retryAnalysis}>
            <Text style={s.retryTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* UC02: FFT spectrum */}
      <Text style={s.secLbl}>Frequency Spectrum</Text>
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
  player: {
    backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_LG,
    padding: 12, marginBottom: 12,
  },
  playerControls: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  playBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: theme.ACCENT,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  playerTime: { color: theme.TEXT_SECONDARY, fontSize: 13, fontVariant: ['tabular-nums'] },
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
