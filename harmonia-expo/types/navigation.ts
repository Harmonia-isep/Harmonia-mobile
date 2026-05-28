export type LibraryStackParamList = {
  Library:     undefined
  TrackDetail: { trackId: number }
  Compare:     { trackId: number }
}

export type PlaylistsStackParamList = {
  Playlists:      undefined
  PlaylistDetail: { playlistId: number }
}

export type MainTabParamList = {
  LibraryStack:   undefined
  PlaylistsStack: undefined
}

export type RootStackParamList = {
  Login: undefined
  Main:  undefined
}
