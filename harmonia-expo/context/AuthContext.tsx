import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AuthUser, loginUser, registerUser, getOrCreateUserId } from '../data/api'

interface AuthContextType {
  user:            AuthUser | null
  isLoading:       boolean
  login:           (username: string, password: string) => Promise<void>
  register:        (username: string, password: string) => Promise<void>
  continueAsGuest: () => Promise<void>
  logout:          () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem('harmonia_user')
      .then(json => { if (json) setUser(JSON.parse(json)) })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const u = await loginUser(username, password)
    await AsyncStorage.setItem('harmonia_user', JSON.stringify(u))
    setUser(u)
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    const u = await registerUser(username, password)
    await AsyncStorage.setItem('harmonia_user', JSON.stringify(u))
    setUser(u)
  }, [])

  const continueAsGuest = useCallback(async () => {
    const id = await getOrCreateUserId()
    const guestUser: AuthUser = { id, username: 'Guest', is_guest: true }
    await AsyncStorage.setItem('harmonia_user', JSON.stringify(guestUser))
    setUser(guestUser)
  }, [])

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove(['harmonia_user', 'harmonia_user_id'])
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, continueAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
