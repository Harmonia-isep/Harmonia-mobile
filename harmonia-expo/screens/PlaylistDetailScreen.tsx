import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, SafeAreaView, StatusBar,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRoute, RouteProp } from '@react-navigation/native'
import { useFocusEffect } from '@react-navigation/native'

import { theme } from '../constants/theme'
import { loadPlaylists, updatePlaylist, Playlist } from '../data/storage'
import { useTracks } from '../context/TrackContext'
import { useAuth } from '../context/AuthContext'
import { Track } from '../data/api'
import { PlaylistsStackParamList } from '../types/navigation'

type RouteP = RouteProp<PlaylistsStackParamList, 'PlaylistDetail'>

export default function PlaylistDetailScreen() {
  const route    = useRoute<RouteP>()
  const { tracks } = useTracks()
  const { user } = useAuth()
  const userId = user?.id ?? 0

  const [playlist,   setPlaylist]   = useState<Playlist | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  useFocusEffect(useCallback(() => {
    loadPlaylists(userId).then(list => {
      setPlaylist(list.find(p => p.id === route.params.playlistId) ?? null)
    })
  }, [userId, route.params.playlistId]))

  if (!playlist) return (
    <View style={s.center}><Text style={{ color: theme.TEXT_SECONDARY }}>Playlist not found.</Text></View>
  )

  const pl = playlist as Playlist

  const byId = Object.fromEntries(tracks.map(t => [t.id, t]))
  const tracksInPl: Track[] = pl.tracks.map(id => byId[id]).filter(Boolean) as Track[]

  async function persist(updated: Playlist) {
    setPlaylist(updated)
    await updatePlaylist(userId, updated)
  }

  async function addTrack(trackId: number) {
    if (pl.tracks.includes(trackId)) return
    const updated: Playlist = { ...pl, tracks: [...pl.tracks, trackId] }
    await persist(updated)
    setShowPicker(false)
  }

  async function removeTrack(trackId: number) {
    const updated: Playlist = { ...pl, tracks: pl.tracks.filter(id => id !== trackId) }
    await persist(updated)
  }

  async function moveTrack(trackId: number, direction: -1 | 1) {
    const idx = pl.tracks.indexOf(trackId)
    if (idx === -1) return
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= pl.tracks.length) return
    const arr = [...pl.tracks]
    ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
    await persist({ ...pl, tracks: arr })
  }

  const available = tracks.filter(t => !pl.tracks.includes(t.id))

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.BG_PRIMARY} />
      <View style={s.root}>

        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>{pl.name}</Text>
          <TouchableOpacity style={[s.addBtn, { borderColor: theme.ACCENT }]}
            onPress={() => setShowPicker(true)} disabled={available.length === 0}>
            <Text style={[s.addBtnTxt, { color: theme.ACCENT, opacity: available.length ? 1 : 0.4 }]}>+ Add</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={tracksInPl}
          keyExtractor={t => String(t.id)}
          contentContainerStyle={{ paddingBottom: 24 }}
          extraData={playlist.tracks}
          ListEmptyComponent={
            <Text style={s.empty}>No tracks — tap "+ Add" to add from your library</Text>
          }
          renderItem={({ item, index }) => (
            <View style={s.row}>
              <Text style={s.rowNum}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={s.rowArtist} numberOfLines={1}>{item.artist}</Text>
              </View>
              <Text style={s.rowBpm}>{item.bpm}</Text>
              <View style={s.rowBtns}>
                {index > 0 && (
                  <TouchableOpacity style={s.miniBtn} onPress={() => moveTrack(item.id, -1)}>
                    <Text style={s.miniBtnTxt}>↑</Text>
                  </TouchableOpacity>
                )}
                {index < tracksInPl.length - 1 && (
                  <TouchableOpacity style={s.miniBtn} onPress={() => moveTrack(item.id, 1)}>
                    <Text style={s.miniBtnTxt}>↓</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={s.rmBtn} onPress={() => removeTrack(item.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={13} color={theme.TEXT_TERTIARY} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />

        {/* Add-track picker modal */}
        <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
          <View style={s.overlay}>
            <View style={s.sheet}>
              <Text style={s.sheetTitle}>Add Track to "{pl.name}"</Text>
              <FlatList
                data={available}
                keyExtractor={t => String(t.id)}
                renderItem={({ item }) => (
                  <TouchableOpacity style={s.sheetItem} onPress={() => addTrack(item.id)}>
                    <Text style={s.sheetItemTitle}>{item.title}</Text>
                    <Text style={s.sheetItemSub}>{item.artist} · {item.bpm} BPM · {item.key}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={s.empty}>All library tracks are already in this playlist</Text>
                }
              />
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowPicker(false)}>
                <Text style={{ color: theme.ACCENT, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: theme.BG_PRIMARY },
  root:   { flex: 1, paddingHorizontal: 14, paddingTop: 14 },
  center: { flex: 1, backgroundColor: theme.BG_PRIMARY, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title:  { color: theme.TEXT_PRIMARY, fontSize: 20, fontWeight: 'bold', flex: 1 },
  addBtn: { borderWidth: 1, borderRadius: theme.RADIUS_SM, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnTxt: { fontSize: 13, fontWeight: 'bold' },
  empty:  { color: theme.TEXT_TERTIARY, fontSize: 13, textAlign: 'center', paddingTop: 40 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 10, height: 52, marginBottom: 4,
  },
  rowNum:    { color: theme.TEXT_TERTIARY, fontSize: 11, width: 20 },
  rowTitle:  { color: theme.TEXT_PRIMARY, fontWeight: 'bold', fontSize: 13 },
  rowArtist: { color: theme.TEXT_SECONDARY, fontSize: 11 },
  rowBpm:    { color: theme.INFO, fontSize: 11, width: 36, textAlign: 'right' },
  rowBtns:   { flexDirection: 'row', gap: 4, marginLeft: 6 },
  miniBtn:   { width: 22, height: 22, backgroundColor: theme.BG_ELEVATED, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  miniBtnTxt:{ color: theme.TEXT_SECONDARY, fontSize: 12 },
  rmBtn:     { width: 22, height: 22, justifyContent: 'center', alignItems: 'center' },
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: theme.BG_SECONDARY, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '70%' },
  sheetTitle:{ color: theme.TEXT_PRIMARY, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  sheetItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.BORDER },
  sheetItemTitle: { color: theme.TEXT_PRIMARY, fontSize: 13, fontWeight: 'bold' },
  sheetItemSub:   { color: theme.TEXT_SECONDARY, fontSize: 11, marginTop: 2 },
  cancelBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
})
