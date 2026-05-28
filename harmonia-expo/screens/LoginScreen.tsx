import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView, StatusBar,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from '../constants/theme'
import { useAuth } from '../context/AuthContext'

type Mode = 'login' | 'register'

export default function LoginScreen() {
  const { login, register, continueAsGuest } = useAuth()

  const [mode,      setMode]      = useState<Mode>('login')
  const [username,  setUsername]  = useState('')
  const [password,  setPassword]  = useState('')
  const [error,     setError]     = useState('')
  const [isLoading, setIsLoading] = useState(false)

  function switchMode(m: Mode) { setMode(m); setError('') }

  async function handleSubmit() {
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required')
      return
    }
    setIsLoading(true)
    setError('')
    try {
      if (mode === 'login') await login(username.trim(), password)
      else                  await register(username.trim(), password)
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleGuest() {
    setIsLoading(true)
    setError('')
    try {
      await continueAsGuest()
    } catch (e: any) {
      setError(e.message ?? 'Could not continue as guest')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={theme.BG_PRIMARY} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.kav}
      >
        <View style={s.inner}>

          {/* Logo */}
          <View style={s.logoBox}>
            <Ionicons name="headset" size={52} color={theme.ACCENT} />
            <Text style={s.logoText}>Harmonia</Text>
            <Text style={s.logoSub}>Your music library, analyzed</Text>
          </View>

          {/* Mode tabs */}
          <View style={s.tabs}>
            {(['login', 'register'] as Mode[]).map(m => (
              <TouchableOpacity
                key={m} style={[s.tab, mode === m && s.tabActive]}
                onPress={() => switchMode(m)}
              >
                <Text style={[s.tabTxt, mode === m && s.tabTxtActive]}>
                  {m === 'login' ? 'Login' : 'Register'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Inputs */}
          <TextInput
            style={s.input}
            placeholder="Username"
            placeholderTextColor={theme.TEXT_TERTIARY}
            value={username}
            onChangeText={t => { setUsername(t); setError('') }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor={theme.TEXT_TERTIARY}
            value={password}
            onChangeText={t => { setPassword(t); setError('') }}
            secureTextEntry
          />

          {!!error && <Text style={s.errTxt}>{error}</Text>}

          <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={isLoading} activeOpacity={0.8}>
            {isLoading
              ? <ActivityIndicator color={theme.TEXT_PRIMARY} />
              : <Text style={s.submitTxt}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.guestBtn} onPress={handleGuest} disabled={isLoading}>
            <Text style={s.guestTxt}>Continue as Guest</Text>
          </TouchableOpacity>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: theme.BG_PRIMARY },
  kav:     { flex: 1 },
  inner:   { flex: 1, paddingHorizontal: 28, justifyContent: 'center', paddingBottom: 40 },
  logoBox: { alignItems: 'center', marginBottom: 40 },
  logoText:{ color: theme.TEXT_PRIMARY, fontSize: 30, fontWeight: 'bold', marginTop: 14 },
  logoSub: { color: theme.TEXT_TERTIARY, fontSize: 13, marginTop: 6 },
  tabs: {
    flexDirection: 'row', backgroundColor: theme.BG_SECONDARY,
    borderRadius: theme.RADIUS_MD, marginBottom: 20, padding: 3,
  },
  tab:          { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: theme.RADIUS_SM },
  tabActive:    { backgroundColor: theme.ACCENT },
  tabTxt:       { color: theme.TEXT_SECONDARY, fontWeight: 'bold', fontSize: 13 },
  tabTxtActive: { color: theme.TEXT_PRIMARY },
  input: {
    backgroundColor: theme.BG_SECONDARY, color: theme.TEXT_PRIMARY,
    borderWidth: 1, borderColor: theme.BORDER, borderRadius: theme.RADIUS_SM,
    paddingHorizontal: 14, height: 48, fontSize: 14, marginBottom: 12,
  },
  errTxt:    { color: theme.ERROR, fontSize: 12, marginBottom: 10, textAlign: 'center' },
  submitBtn: {
    backgroundColor: theme.ACCENT, borderRadius: theme.RADIUS_SM,
    height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  submitTxt: { color: theme.TEXT_PRIMARY, fontWeight: 'bold', fontSize: 15 },
  guestBtn:  { alignItems: 'center', paddingVertical: 14 },
  guestTxt:  { color: theme.TEXT_TERTIARY, fontSize: 13 },
})
