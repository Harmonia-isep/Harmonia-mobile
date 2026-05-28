import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEMO_MODE, DEMO_USER, DEMO_TRACKS, demoAnalysis, nextDemoTrack } from '../constants/demo'

const BASE_URL = 'https://harmonia-api-n8zp.onrender.com'

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
