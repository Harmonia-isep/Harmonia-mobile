import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEMO_MODE, DEMO_USER, DEMO_TRACKS, demoAnalysis, nextDemoTrack } from '../constants/demo'

// Env-driven, but the live Render backend is the hardcoded fallback so the app
// never silently drops to demo data. Expo inlines EXPO_PUBLIC_* vars from the
// matching .env file at build time (.env.development for `expo start`,
// .env.production for prod builds); both currently point at Render.
// We fall back when the var is missing OR blank, then strip any trailing slash
// so joinUrl() never produces a double slash.
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL?.trim()
export const BASE_URL = (
  ENV_API_URL && ENV_API_URL.length > 0
    ? ENV_API_URL
    : 'https://harmonia-api-n8zp.onrender.com'
).replace(/\/+$/, '')

// ── Types ──────────────────────────────────────────────────────────────────

export interface Track {
  id: number
  title: string
  artist: string
  album?: string
  duration: string
  bpm: number | '—'
  key: string
  status: string
  upload_date?: string
  file_path?: string
}

export interface AuthUser {
  id: number
  username: string
  is_guest: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    const m = Math.floor(value / 60)
    const s = Math.floor(value % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  return String(value)
}

function roundBpm(value: unknown): number | '—' {
  if (typeof value === 'number') return Math.round(value)
  return '—'
}

export function normalizeTrack(
  raw: Record<string, any>,
  analysis?: Record<string, any>
): Track {
  const a = analysis ?? {}
  const keyPart   = a.key   ?? raw.key   ?? ''
  const scalePart = a.scale ?? raw.scale ?? ''
  const keyFull   = [keyPart, scalePart].filter(Boolean).join(' ') || '—'
  return {
    id:          raw.id,
    title:       raw.title  ?? 'Unknown',
    artist:      raw.artist ?? 'Unknown Artist',
    album:       raw.album  ?? undefined,
    duration:    formatDuration(raw.duration ?? raw.duration_seconds),
    bpm:         roundBpm(a.bpm ?? raw.bpm),
    key:         keyFull,
    status:      a.status ?? raw.status ?? 'ready',
    upload_date: raw.uploaded_at ?? raw.created_at ?? raw.upload_date,
    file_path:   raw.file_path ?? raw.path ?? undefined,
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function getOrCreateUserId(): Promise<number> {
  if (DEMO_MODE) return DEMO_USER.id
  const userJson = await AsyncStorage.getItem('harmonia_user')
  if (userJson) {
    const u = JSON.parse(userJson) as AuthUser
    return u.id ?? (u as any).user_id
  }
  const saved = await AsyncStorage.getItem('harmonia_user_id')
  if (saved) return parseInt(saved, 10)

  const resp = await fetch(`${BASE_URL}/api/users/guest`, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  })
  if (!resp.ok) throw new Error(`Guest user creation failed: ${resp.status}`)
  const data = await resp.json()
  const userId: number = data.id ?? data.user_id
  await AsyncStorage.setItem('harmonia_user_id', String(userId))
  return userId
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  if (DEMO_MODE) return { ...DEMO_USER, username: username || DEMO_USER.username }
  const resp = await fetch(`${BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail ?? err.message ?? `Login failed: ${resp.status}`)
  }
  const data = await resp.json()
  return { id: data.id ?? data.user_id, username: data.username, is_guest: data.is_guest ?? false }
}

export async function registerUser(username: string, password: string): Promise<AuthUser> {
  if (DEMO_MODE) return { ...DEMO_USER, username: username || DEMO_USER.username }
  const resp = await fetch(`${BASE_URL}/api/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.detail ?? err.message ?? `Registration failed: ${resp.status}`)
  }
  const data = await resp.json()
  return { id: data.id ?? data.user_id, username: data.username, is_guest: data.is_guest ?? false }
}

// ── Tracks ─────────────────────────────────────────────────────────────────

export async function fetchTracks(): Promise<Track[]> {
  if (DEMO_MODE) return [...DEMO_TRACKS]
  const userId = await getOrCreateUserId()
  const resp = await fetch(`${BASE_URL}/api/tracks/user/${userId}`)
  if (!resp.ok) throw new Error(`Fetch tracks failed: ${resp.status}`)
  const data = await resp.json()
  return (data ?? []).map((t: any) => normalizeTrack(t))
}

export interface TrackFilter {
  search?: string
  key?: string       // root note only, e.g. 'A' — backend matches Analysis.key exactly
  bpm_min?: string
  bpm_max?: string
}

// Mirrors the web app's searchTracks: the BPM/key filters live on the Analysis
// table, which the plain list endpoint does NOT return. So filtering must be done
// server-side via query params (GET /api/tracks/user/{id}?key=A&bpm_min=…), exactly
// like the web. A client-side filter can't work — the device never has the key/bpm.
export async function searchTracks(filter: TrackFilter): Promise<Track[]> {
  if (DEMO_MODE) {
    return DEMO_TRACKS.filter(t => {
      if (filter.search) {
        const q = filter.search.toLowerCase()
        if (!t.title.toLowerCase().includes(q) && !t.artist.toLowerCase().includes(q)) return false
      }
      if (filter.key) {
        const root = String(t.key).split(' ')[0]
        if (root.toLowerCase() !== filter.key.toLowerCase()) return false
      }
      if (filter.bpm_min && typeof t.bpm === 'number' && t.bpm < parseInt(filter.bpm_min, 10)) return false
      if (filter.bpm_max && typeof t.bpm === 'number' && t.bpm > parseInt(filter.bpm_max, 10)) return false
      return true
    }) as Track[]
  }

  const userId = await getOrCreateUserId()
  const params: string[] = []
  if (filter.search)  params.push(`search=${encodeURIComponent(filter.search)}`)
  if (filter.key)     params.push(`key=${encodeURIComponent(filter.key)}`)
  if (filter.bpm_min) params.push(`bpm_min=${encodeURIComponent(filter.bpm_min)}`)
  if (filter.bpm_max) params.push(`bpm_max=${encodeURIComponent(filter.bpm_max)}`)
  const qs = params.length ? `?${params.join('&')}` : ''

  const resp = await fetch(`${BASE_URL}/api/tracks/user/${userId}${qs}`)
  if (!resp.ok) throw new Error(`Search tracks failed: ${resp.status}`)
  const data = await resp.json()
  return (data ?? []).map((t: any) => normalizeTrack(t))
}

export async function deleteTrack(trackId: number): Promise<boolean> {
  if (DEMO_MODE) return true
  const resp = await fetch(`${BASE_URL}/api/tracks/${trackId}`, { method: 'DELETE' })
  return resp.ok
}

export async function uploadTrack(
  fileUri: string,
  fileName: string,
  mimeType: string,
  metadata: { title: string; artist: string; album: string },
  fileBlob?: File | Blob
): Promise<Track> {
  if (DEMO_MODE) return nextDemoTrack(fileName, metadata) as Track
  const userId = await getOrCreateUserId()

  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext !== 'mp3' && ext !== 'wav') {
    throw new Error('Only MP3 and WAV files are supported.')
  }

  const formData = new FormData()
  if (fileBlob) {
    // Web: use the real File object so fetch can serialize it correctly
    formData.append('file', fileBlob, fileName)
  } else {
    // Native: React Native's fetch accepts this { uri, name, type } shape
    formData.append('file', { uri: fileUri, name: fileName, type: mimeType } as any)
  }
  formData.append('user_id', String(userId))
  formData.append('title',   metadata.title  || fileName.replace(/\.[^.]+$/, ''))
  formData.append('artist',  metadata.artist || 'Unknown Artist')
  formData.append('album',   metadata.album  || '')

  const resp = await fetch(`${BASE_URL}/api/tracks/upload`, { method: 'POST', body: formData })
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`)

  const raw = await resp.json()
  const track = normalizeTrack(raw)
  try {
    await triggerAnalysis(track.id)
    track.status = 'pending'
  } catch {}
  return track
}

// ── Analysis ───────────────────────────────────────────────────────────────

// Uses GET /api/tracks/{id} — the teammate's combined endpoint — which returns
// { id, title, artist, analysis: null | { bpm, key, scale, ... } }.
// Returning {} when analysis is null keeps the polling loop going without throwing.
export async function fetchAnalysis(trackId: number): Promise<Record<string, any>> {
  if (DEMO_MODE) return demoAnalysis(trackId) as Record<string, any>
  const resp = await fetch(`${BASE_URL}/api/tracks/${trackId}`)
  if (!resp.ok) throw new Error(`Track fetch failed: ${resp.status}`)
  const data = await resp.json()
  return data.analysis ?? {}
}

export async function triggerAnalysis(trackId: number): Promise<void> {
  if (DEMO_MODE) return
  const resp = await fetch(`${BASE_URL}/api/analysis/analyze/${trackId}`, { method: 'POST' })
  if (!resp.ok) throw new Error(`Trigger analysis failed: ${resp.status}`)
}

// Joins a base origin and a path with exactly one slash between them, so we never
// emit '//' or a missing separator regardless of how BASE_URL is configured.
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

// Mirrors the web's getAudioUrl exactly: the backend streams the raw file through
// GET /api/tracks/{id}/audio (a FileResponse). There is NO static /uploads mount,
// so a relative file_path cannot be fetched directly — always go through this route.
export function getAudioUrl(trackId: number): string {
  return joinUrl(BASE_URL, `api/tracks/${trackId}/audio`)
}
