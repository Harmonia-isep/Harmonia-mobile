import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, SafeAreaView, StatusBar, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { theme } from '../constants/theme'
import { loadPlaylists, createPlaylist, deletePlaylist, Playlist } from '../data/storage'
import { useAuth } from '../context/AuthContext'
import { PlaylistsStackParamList } from '../types/navigation'

type NavProp = NativeStackNavigationProp<PlaylistsStackParamList, 'Playlists'>

export default function PlaylistsScreen() {
  const nav = useNavigation<NavProp>()
  const { user } = useAuth()
  // PlaylistsScreen is only rendered inside MainTabs which requires authentication,
  // so user is always non-null here. Fall back to 0 only to satisfy TypeScript.
  const userId = user?.id ?? 0

  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [showModal, setShowModal] = useState(false)
  const [newName,   setNewName]   = useState('')
  const [nameError, setNameError] = useState('')

  useFocusEffect(useCallback(() => {
    loadPlaylists(userId).then(setPlaylists)
  }, [userId]))

  async function handleCreate() {
    const name = newName.trim()
    if (!name) { setNameError('Name cannot be empty'); return }
    if (playlists.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      setNameError('A playlist with that name already exists')
      return
    }
    const updated = await createPlaylist(userId, name)
    setPlaylists(updated)
    setNewName('')
    setNameError('')
    setShowModal(false)
  }

  function handleDelete(pl: Playlist) {
    const doDelete = async () => {
      const updated = await deletePlaylist(userId, pl.id)
      setPlaylists(updated)
    }
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete "${pl.name}"?\nTracks remain in the library.`)) doDelete()
    } else {
      Alert.alert('Delete Playlist', `Delete "${pl.name}"?\nTracks remain in the library.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ])
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.BG_PRIMARY} />
      <View style={s.root}>

        <View style={s.header}>
          <Text style={s.title}>Playlists</Text>
          <TouchableOpacity style={[s.newBtn, { borderColor: theme.ACCENT }]}
            onPress={() => { setNewName(''); setNameError(''); setShowModal(true) }}>
            <Text style={[s.newBtnTxt, { color: theme.ACCENT }]}>+ New</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={playlists}
          keyExtractor={p => String(p.id)}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <Text style={s.empty}>No playlists yet — tap "+ New" to create one</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card}
              onPress={() => nav.navigate('PlaylistDetail', { playlistId: item.id })}
              activeOpacity={0.7}>
              <Ionicons name="list" size={18} color={theme.ACCENT} style={s.cardIcon} />
              <View style={{ flex: 1 }}>
                <Text style={s.cardName}>{item.name}</Text>
                <Text style={s.cardCount}>
                  {item.tracks.length} track{item.tracks.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <TouchableOpacity style={s.delBtn}
                onPress={() => handleDelete(item)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={14} color={theme.TEXT_TERTIARY} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />

        {/* Create playlist modal */}
        <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
          <View style={s.overlay}>
            <View style={s.modal}>
              <Text style={s.modalTitle}>New Playlist</Text>
              <TextInput
                style={[s.modalInput, nameError ? s.modalInputErr : null]}
                placeholder="Playlist name"
                placeholderTextColor={theme.TEXT_TERTIARY}
                value={newName}
                onChangeText={t => { setNewName(t); setNameError('') }}
                autoFocus
              />
              {!!nameError && <Text style={s.errTxt}>{nameError}</Text>}
              <View style={s.modalBtns}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={{ color: theme.TEXT_SECONDARY, fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.createBtn} onPress={handleCreate}>
                  <Text style={{ color: theme.BG_PRIMARY, fontWeight: 'bold', fontSize: 14 }}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: theme.BG_PRIMARY },
  root:  { flex: 1, paddingHorizontal: 14, paddingTop: 14 },
  header:{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title: { color: theme.TEXT_PRIMARY, fontSize: 20, fontWeight: 'bold', flex: 1 },
  newBtn:{ borderWidth: 1, borderRadius: theme.RADIUS_SM, paddingHorizontal: 12, paddingVertical: 6 },
  newBtnTxt: { fontSize: 13, fontWeight: 'bold' },
  empty: { color: theme.TEXT_TERTIARY, fontSize: 13, textAlign: 'center', paddingTop: 40 },
  card:  { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_SM, paddingHorizontal: 12, height: 56, marginBottom: 4 },
  cardIcon:  { width: 24 },
  cardName:  { color: theme.TEXT_PRIMARY, fontWeight: 'bold', fontSize: 13 },
  cardCount: { color: theme.TEXT_SECONDARY, fontSize: 11 },
  delBtn:    { width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modal:     { backgroundColor: theme.BG_SECONDARY, borderRadius: theme.RADIUS_LG, padding: 20, width: 300 },
  modalTitle:{ color: theme.TEXT_PRIMARY, fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  modalInput:{ backgroundColor: theme.BG_TERTIARY, color: theme.TEXT_PRIMARY, borderWidth: 1, borderColor: theme.BORDER, borderRadius: theme.RADIUS_SM, paddingHorizontal: 12, height: 40, fontSize: 14 },
  modalInputErr: { borderColor: theme.ERROR },
  errTxt:    { color: theme.ERROR, fontSize: 12, marginTop: 4 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  createBtn: { backgroundColor: theme.ACCENT, borderRadius: theme.RADIUS_SM, paddingHorizontal: 16, paddingVertical: 8 },
})
