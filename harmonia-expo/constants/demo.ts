// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE
// Set DEMO_MODE = false to restore all live API calls for production / grading.
// ─────────────────────────────────────────────────────────────────────────────
export const DEMO_MODE = false

// ── Mock authenticated user ───────────────────────────────────────────────────
export const DEMO_USER = {
  id:       1,
  username: 'demo_user',
  is_guest: false,
}

// ── Pre-populated track library ───────────────────────────────────────────────
// All tracks have complete metadata so every screen renders immediately.
export const DEMO_TRACKS = [
  {
    id: 1, title: 'Beat It',         artist: 'Michael Jackson', album: 'Thriller',
    duration: '4:18', bpm: 138,  key: 'A minor',  status: 'analyzed', upload_date: '2026-05-29',
  },
  {
    id: 2, title: 'Kill This Love',  artist: 'BLACKPINK',       album: 'Kill This Love',
    duration: '3:06', bpm: 132,  key: 'G minor',  status: 'analyzed', upload_date: '2026-05-29',
  },
  {
    id: 3, title: 'Blinding Lights', artist: 'The Weeknd',      album: 'After Hours',
    duration: '3:22', bpm: 171,  key: 'F minor',  status: 'analyzed', upload_date: '2026-05-29',
  },
  {
    id: 4, title: 'Levitating',      artist: 'Dua Lipa',        album: 'Future Nostalgia',
    duration: '3:23', bpm: 103,  key: 'B major',  status: 'analyzed', upload_date: '2026-05-29',
  },
  {
    id: 5, title: 'One Dance',       artist: 'Drake',           album: 'Views',
    duration: '3:54', bpm: 104,  key: 'D minor',  status: 'analyzed', upload_date: '2026-05-29',
  },
]

// ── Per-track analysis payloads ───────────────────────────────────────────────
// Returned instantly by fetchAnalysis() so TrackDetailScreen populates with no polling.
const ANALYZED_AT = '2026-05-29T09:00:00.000000'
const KNOWN_ANALYSIS: Record<number, Record<string, unknown>> = {
  1: { bpm: 138.0, key: 'A', scale: 'minor', energy: 0.82, danceability: 0.74, analyzed_at: ANALYZED_AT },
  2: { bpm: 132.0, key: 'G', scale: 'minor', energy: 0.91, danceability: 0.88, analyzed_at: ANALYZED_AT },
  3: { bpm: 171.0, key: 'F', scale: 'minor', energy: 0.85, danceability: 0.79, analyzed_at: ANALYZED_AT },
  4: { bpm: 103.0, key: 'B', scale: 'major', energy: 0.65, danceability: 0.82, analyzed_at: ANALYZED_AT },
  5: { bpm: 104.0, key: 'D', scale: 'minor', energy: 0.72, danceability: 0.76, analyzed_at: ANALYZED_AT },
}

// Fallback used for any track uploaded during the demo session.
const FALLBACK_ANALYSIS = { bpm: 128.0, key: 'C', scale: 'major', energy: 0.75, danceability: 0.80, analyzed_at: ANALYZED_AT }

export function demoAnalysis(trackId: number): Record<string, unknown> {
  return KNOWN_ANALYSIS[trackId] ?? FALLBACK_ANALYSIS
}

// ── Mock upload ───────────────────────────────────────────────────────────────
// Each simulated upload produces a unique track with full metadata already set.
let _uploadCounter = DEMO_TRACKS.length

export function nextDemoTrack(
  fileName: string,
  meta?: { title?: string; artist?: string; album?: string }
) {
  _uploadCounter += 1
  const defaultTitle = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ')
  return {
    id:          _uploadCounter,
    title:       meta?.title  || defaultTitle,
    artist:      meta?.artist || 'Unknown Artist',
    album:       meta?.album  || undefined,
    duration:    '3:30',
    bpm:         128,
    key:         'C major',
    status:      'analyzed',
    upload_date: new Date().toISOString().split('T')[0],
  }
}
