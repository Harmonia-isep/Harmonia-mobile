import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Track, fetchTracks } from '../data/api'
import { MOCK_TRACKS } from '../constants/mock'
import { useAuth } from './AuthContext'

interface TrackContextType {
  tracks:    Track[]
  isLoading: boolean
  isOffline: boolean
  loadTracks: () => Promise<void>
  setTracks:  React.Dispatch<React.SetStateAction<Track[]>>
}

const TrackContext = createContext<TrackContextType | null>(null)

export function TrackProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [tracks,    setTracks]    = useState<Track[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOffline, setIsOffline] = useState(false)

  // Clear stale tracks immediately when the user logs out so a different
  // user who logs in next never briefly sees the previous user's library.
  useEffect(() => {
    if (!user) setTracks([])
  }, [user])

  const loadTracks = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await fetchTracks()
      setTracks(data)
      setIsOffline(false)
    } catch {
      setTracks(MOCK_TRACKS)
      setIsOffline(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return (
    <TrackContext.Provider value={{ tracks, isLoading, isOffline, loadTracks, setTracks }}>
      {children}
    </TrackContext.Provider>
  )
}

export function useTracks(): TrackContextType {
  const ctx = useContext(TrackContext)
  if (!ctx) throw new Error('useTracks must be inside <TrackProvider>')
  return ctx
}
