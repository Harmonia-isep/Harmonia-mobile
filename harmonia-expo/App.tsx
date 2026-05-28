import React from 'react'
import { View, ActivityIndicator } from 'react-native'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'

import { AuthProvider, useAuth } from './context/AuthContext'
import { TrackProvider } from './context/TrackContext'
import { theme } from './constants/theme'

import LoginScreen          from './screens/LoginScreen'
import LibraryScreen        from './screens/LibraryScreen'
import TrackDetailScreen    from './screens/TrackDetailScreen'
import CompareScreen        from './screens/CompareScreen'
import PlaylistsScreen      from './screens/PlaylistsScreen'
import PlaylistDetailScreen from './screens/PlaylistDetailScreen'

import {
  LibraryStackParamList,
  PlaylistsStackParamList,
  MainTabParamList,
  RootStackParamList,
} from './types/navigation'

const LibStack  = createNativeStackNavigator<LibraryStackParamList>()
const PlStack   = createNativeStackNavigator<PlaylistsStackParamList>()
const Tab       = createBottomTabNavigator<MainTabParamList>()
const RootStack = createNativeStackNavigator<RootStackParamList>()

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background:   theme.BG_PRIMARY,
    card:         theme.BG_SECONDARY,
    text:         theme.TEXT_PRIMARY,
    border:       theme.BORDER,
    notification: theme.ACCENT,
    primary:      theme.ACCENT,
  },
}

const stackOpts = {
  headerStyle:      { backgroundColor: theme.BG_SECONDARY },
  headerTintColor:  theme.ACCENT,
  headerTitleStyle: { color: theme.TEXT_PRIMARY, fontWeight: 'bold' as const },
  contentStyle:     { backgroundColor: theme.BG_PRIMARY },
}

function LibraryNavigator() {
  return (
    <LibStack.Navigator screenOptions={stackOpts}>
      <LibStack.Screen name="Library"     component={LibraryScreen}     options={{ headerShown: false }} />
      <LibStack.Screen name="TrackDetail" component={TrackDetailScreen} options={{ title: 'Track Detail' }} />
      <LibStack.Screen name="Compare"     component={CompareScreen}     options={{ title: 'Compare Tracks' }} />
    </LibStack.Navigator>
  )
}

function PlaylistsNavigator() {
  return (
    <PlStack.Navigator screenOptions={stackOpts}>
      <PlStack.Screen name="Playlists"      component={PlaylistsScreen}      options={{ headerShown: false }} />
      <PlStack.Screen name="PlaylistDetail" component={PlaylistDetailScreen} options={{ title: 'Playlist' }} />
    </PlStack.Navigator>
  )
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle:             { backgroundColor: theme.BG_SECONDARY, borderTopColor: theme.BORDER },
        tabBarActiveTintColor:   theme.ACCENT,
        tabBarInactiveTintColor: theme.TEXT_TERTIARY,
        tabBarIcon: ({ color, size }) => {
          const iconName = route.name === 'LibraryStack' ? 'library-outline' : 'list-outline'
          return <Ionicons name={iconName as any} size={size} color={color} />
        },
      })}
    >
      <Tab.Screen name="LibraryStack"   component={LibraryNavigator}   options={{ tabBarLabel: 'Library' }} />
      <Tab.Screen name="PlaylistsStack" component={PlaylistsNavigator} options={{ tabBarLabel: 'Playlists' }} />
    </Tab.Navigator>
  )
}

function AppNavigator() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.BG_PRIMARY, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={theme.ACCENT} size="large" />
      </View>
    )
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {user
        ? <RootStack.Screen name="Main"  component={MainTabs}    />
        : <RootStack.Screen name="Login" component={LoginScreen} />
      }
    </RootStack.Navigator>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <TrackProvider>
        <NavigationContainer theme={navTheme}>
          <AppNavigator />
        </NavigationContainer>
      </TrackProvider>
    </AuthProvider>
  )
}
