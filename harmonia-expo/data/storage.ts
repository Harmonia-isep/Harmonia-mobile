import AsyncStorage from '@react-native-async-storage/async-storage'

export interface Playlist {
  id: number
  name: string
  tracks: number[]
}

// Each user gets their own storage bucket so playlists never leak between accounts.
const storageKey = (userId: number) => `harmonia_playlists_${userId}`

function nextId(list: Playlist[]): number {
  return list.length === 0 ? 1 : Math.max(...list.map(p => p.id)) + 1
}

export async function loadPlaylists(userId: number): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function savePlaylists(userId: number, playlists: Playlist[]): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(playlists))
}

export async function createPlaylist(userId: number, name: string): Promise<Playlist[]> {
  const list = await loadPlaylists(userId)
  list.push({ id: nextId(list), name, tracks: [] })
  await savePlaylists(userId, list)
  return list
}

export async function deletePlaylist(userId: number, id: number): Promise<Playlist[]> {
  const list = (await loadPlaylists(userId)).filter(p => p.id !== id)
  await savePlaylists(userId, list)
  return list
}

export async function updatePlaylist(userId: number, updated: Playlist): Promise<void> {
  const list = await loadPlaylists(userId)
  const idx  = list.findIndex(p => p.id === updated.id)
  if (idx !== -1) {
    list[idx] = updated
    await savePlaylists(userId, list)
  }
}
