import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'harmonia_playlists'

export interface Playlist {
  id: number
  name: string
  tracks: number[]
}

export async function loadPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(playlists))
}

function nextId(list: Playlist[]): number {
  return list.length === 0 ? 1 : Math.max(...list.map(p => p.id)) + 1
}

export async function createPlaylist(name: string): Promise<Playlist[]> {
  const list = await loadPlaylists()
  list.push({ id: nextId(list), name, tracks: [] })
  await savePlaylists(list)
  return list
}

export async function deletePlaylist(id: number): Promise<Playlist[]> {
  const list = (await loadPlaylists()).filter(p => p.id !== id)
  await savePlaylists(list)
  return list
}

export async function updatePlaylist(updated: Playlist): Promise<void> {
  const list = await loadPlaylists()
  const idx  = list.findIndex(p => p.id === updated.id)
  if (idx !== -1) {
    list[idx] = updated
    await savePlaylists(list)
  }
}
