# Harmonia Mobile — Session Summary & Change Log

**Project:** Harmonia Mobile (Expo / React Native)
**Date:** 2026-05-28
**Developer:** Inas Mezouri

---

## 1. Architectural Pivot — PySide6 Desktop → Expo / React Native

### What changed and why

The original mobile prototype was built with **PySide6** (Python + Qt), running inside a fixed 390 × 760 px window to simulate a phone screen on a desktop PC. While functional for a demo, this approach has a fundamental problem: **a PySide6 app cannot be published to the Google Play Store or Apple App Store**. It produces a desktop executable, not a mobile APK/AAB.

The decision was made to pivot to **Expo (React Native)** — a JavaScript/TypeScript framework that compiles to real native iOS and Android apps.

### Before (PySide6)

| Property | Value |
|---|---|
| Language | Python 3 |
| UI Framework | PySide6 / Qt Widgets |
| Runs on | Windows/macOS/Linux desktop only |
| Play Store deployable | No |
| Styling | QSS (Qt Style Sheets) |
| Persistence | JSON files on disk |
| Navigation | QStackedWidget |

### After (Expo / React Native)

| Property | Value |
|---|---|
| Language | TypeScript |
| UI Framework | React Native 0.85 (Expo SDK 56) |
| Runs on | Android, iOS, and web browser |
| Play Store deployable | Yes (via `eas build`) |
| Styling | React Native StyleSheet (JS objects) |
| Persistence | AsyncStorage (device-native key-value store) |
| Navigation | React Navigation v7 (stack + bottom tabs) |

### What was preserved

All eight use cases from the original specification were re-implemented in React Native:

| UC | Description | Status |
|---|---|---|
| UC01 | Upload audio file (MP3 / WAV) | Done |
| UC02 | View track analysis (FFT spectrum + waveform) | Done |
| UC03 | Search and filter library (title, artist, BPM, key) | Done |
| UC04 | Manage playlists (create, delete, reorder tracks) | Done |
| UC05 | Delete a track | Done |
| UC06 | Compare two tracks side by side | Done |
| UC07 | Discover similar tracks (BPM ± 5, matching root key) | Done |
| UC08 | Export library to CSV | Done |

---

## 2. Complete File Inventory

### New files created

| File | Purpose |
|---|---|
| `context/AuthContext.tsx` | Auth state provider — `login`, `register`, `continueAsGuest`, `logout`. Persists authenticated user to AsyncStorage under key `harmonia_user`. |
| `screens/LoginScreen.tsx` | Combined login / register screen with mode toggle tabs, Ionicons branding, error display, and guest access. |

### Files fully rewritten

| File | What changed |
|---|---|
| `App.tsx` | Complete rewrite. Now wraps everything in `AuthProvider` → `TrackProvider` → `NavigationContainer`. Added `AppNavigator` component (auth-conditional routing), `createBottomTabNavigator` with Library and Playlists tabs, and two nested `createNativeStackNavigator` instances. |
| `types/navigation.ts` | Replaced single flat `RootStackParamList` with four separate typed param lists: `LibraryStackParamList`, `PlaylistsStackParamList`, `MainTabParamList`, `RootStackParamList`. |
| `data/api.ts` | Added `AuthUser` interface. Added `loginUser()` (`POST /api/users/login`) and `registerUser()` (`POST /api/users/register`). Updated `getOrCreateUserId()` to check `harmonia_user` in AsyncStorage before falling back to the legacy guest flow. |
| `screens/LibraryScreen.tsx` | Replaced all emoji characters with `Ionicons`. Removed the `≡` Playlists button (now a bottom tab). Added logout button (`log-out-outline`). Updated navigation type to `LibraryStackParamList`. Imported `useAuth` for logout. |
| `screens/TrackDetailScreen.tsx` | Replaced `🎵`, `⏱`, `⚠` with `Ionicons`. Updated `ActionBtn` component to accept `iconName` prop. Updated navigation type to `LibraryStackParamList`. |
| `screens/CompareScreen.tsx` | Updated navigation type from `RootStackParamList` to `LibraryStackParamList`. |
| `screens/PlaylistsScreen.tsx` | Replaced `≡` card icon and `✕` delete text with `Ionicons`. Updated navigation type to `PlaylistsStackParamList`. |
| `screens/PlaylistDetailScreen.tsx` | Replaced `✕` remove button text with `Ionicons`. Updated navigation type to `PlaylistsStackParamList`. |

### Files that did not require changes

| File | Reason |
|---|---|
| `context/TrackContext.tsx` | No changes needed — `fetchTracks()` calls `getOrCreateUserId()` internally, which now transparently handles auth users. |
| `constants/theme.ts` | Design tokens were already correct and match the web project. |
| `constants/mock.ts` | Mock tracks unchanged. |
| `data/storage.ts` | Playlist CRUD via AsyncStorage unchanged. |
| `components/WaveformBar.tsx` | SVG waveform component unchanged. |
| `components/FFTBar.tsx` | SVG FFT spectrum component unchanged. |

### Installed packages

```
@expo/vector-icons     (Ionicons icon set)
@react-navigation/bottom-tabs  (bottom tab bar navigator)
```

---

## 3. UI Improvements — Matching the Web Design

### 3.1 Icon system — emojis removed, Ionicons added

Every interactive button and decorative icon that previously used an emoji or Unicode symbol has been replaced with a vector icon from `@expo/vector-icons` (Ionicons).

| Old (emoji / symbol) | New (Ionicons name) | Location |
|---|---|---|
| `↻` (refresh) | `refresh-outline` | LibraryScreen header |
| `+` (upload) | `cloud-upload-outline` | LibraryScreen header |
| `⬇` (export) | `download-outline` | LibraryScreen header |
| `≡` (playlists) | removed (now a bottom tab) | LibraryScreen header |
| *(new)* | `log-out-outline` | LibraryScreen header |
| `♪` (track card) | `musical-note` | LibraryScreen track list |
| `✕` (delete card) | `close` | LibraryScreen track list |
| `🎵` (album art) | `musical-note` size 64 | TrackDetailScreen |
| `⏱` (duration) | `time-outline` | TrackDetailScreen |
| `⚠` (error) | `warning-outline` | TrackDetailScreen |
| `🗑  Delete` | `trash-outline` + "Delete" | TrackDetailScreen action row |
| `⇄  Compare` | `swap-horizontal-outline` + "Compare" | TrackDetailScreen action row |
| `♪  Similar` | `musical-notes-outline` + "Similar" | TrackDetailScreen action row |
| `≡` (playlist card) | `list` | PlaylistsScreen list |
| `✕` (delete playlist) | `close` | PlaylistsScreen list |
| `✕` (remove track) | `close` size 13 | PlaylistDetailScreen |
| `🎧` (headset) | `headset` size 52 | LoginScreen logo |

### 3.2 Bottom navigation bar

Previously, switching between the Library and Playlists sections required tapping a small `≡` button inside the Library header — this was not discoverable and not standard mobile UX.

The new navigation structure uses `createBottomTabNavigator` from `@react-navigation/bottom-tabs`:

```
Bottom Tab Bar
├── Library  (icon: library-outline)
│   └── Stack: LibraryScreen → TrackDetailScreen → CompareScreen
└── Playlists  (icon: list-outline)
    └── Stack: PlaylistsScreen → PlaylistDetailScreen
```

The tab bar uses the project's dark theme colors:
- Background: `BG_SECONDARY` (`#161618`)
- Active tint: `ACCENT` (`#ff3b30`)
- Inactive tint: `TEXT_TERTIARY` (`#48484a`)
- Top border: `BORDER` (`rgba(255,255,255,0.08)`)

### 3.3 Authentication screens

A full-screen `LoginScreen` was added that matches the web project's auth design:

- Dark background (`BG_PRIMARY`)
- Ionicons `headset` logo with "Harmonia" wordmark
- Segmented tab control to switch between Login and Register modes
- Username + password text inputs with the project's dark input style
- Red accent submit button (`ACCENT`)
- "Continue as Guest" option at the bottom

The screen appears automatically when no user is stored in AsyncStorage, and disappears (replaced by the main tabs) as soon as authentication succeeds — no manual navigation required.

### 3.4 Theme consistency

All color values in `constants/theme.ts` are identical to the web project's CSS variables. The same tokens are reused across all screens, so visual parity is maintained between the Expo app and the React web app.

---

## 4. Technical Defense — Why Expo / React Native is the Correct Architecture

*This section is prepared for presentation to your assessor.*

---

### 4.1 The core requirement: Play Store deployment

The project specification requires delivery of a **mobile application** on the Google Play Store (and optionally the Apple App Store). This is a hard technical constraint that eliminates several options:

- **PySide6** produces a desktop `.exe` or Linux binary. There is no supported path to package it as an Android APK. ✗
- **Flask / Django web app** served in a WebView is possible but is explicitly discouraged by Google Play's policies for apps that are "thin wrappers" around a website. ✗
- **Expo / React Native** uses the same JavaScript business logic but compiles to real native Android and iOS binaries. `eas build --platform android` produces a signed `.aab` ready for Play Store submission. ✓

### 4.2 Shared codebase, two platforms

React Native's "write once, run on iOS and Android" model means:

- One TypeScript codebase targets both platforms.
- The same API client (`data/api.ts`) works on both.
- The same design tokens (`constants/theme.ts`) produce a consistent look on both.

This halves the maintenance cost compared to writing a separate Swift and Kotlin app.

### 4.3 Expo SDK reduces native complexity

Without Expo, React Native requires Xcode (macOS only) for iOS builds and Android Studio configuration. Expo abstracts this away:

- `npx expo start` runs the app on a real device immediately via the Expo Go app — no build step needed for development.
- `eas build` handles compilation and code-signing on Expo's cloud servers.
- Expo SDK 56 ships pre-configured packages for audio (`expo-av`), file access (`expo-file-system`), document picking (`expo-document-picker`), and sharing (`expo-sharing`) — all used in this project.

### 4.4 Direct API integration

The Harmonia backend (`https://harmonia-api-n8zp.onrender.com`) exposes a REST API. The Expo app calls it directly over HTTPS using the standard `fetch` API — the same way the React web app does. There is no need for a separate mobile backend.

Authentication is cross-platform: a user can register on the web app and log into the mobile app with the same credentials, and their uploaded tracks appear in both places.

### 4.5 TypeScript provides correctness guarantees

The entire codebase is strictly typed:

- Navigation routes are typed with `NativeStackNavigationProp<LibraryStackParamList, 'TrackDetail'>` — TypeScript will error if you try to navigate to a screen that doesn't exist or pass the wrong params.
- The `Track` and `AuthUser` interfaces define the exact shape of API responses.
- Running `npx tsc --noEmit` after every session confirms **zero type errors**.

### 4.6 The visualization layer

The PySide6 app used `QPainter` and `QLinearGradient` to draw waveform and FFT bar charts. React Native does not have a canvas API, so the charts were re-implemented using `react-native-svg` (SVG rendered natively via the platform's SVG engine). The visual result is identical, and the seeded-RNG approach ensures the visualization is deterministic and reproducible for any given track ID.

---

## 5. How to Start and Test the App

### Prerequisites

- Node.js 18 or newer
- npm 9 or newer
- The **Expo Go** app installed on your Android or iOS phone (free, from the Play Store / App Store)

---

### Step 1 — Install dependencies

Open a terminal in the project root and run:

```bash
cd harmonia-expo
npm install
```

---

### Step 2 — Start the development server

```bash
npx expo start
```

A QR code will appear in the terminal and in the browser window that opens automatically.

---

### Step 3a — Test on a real phone (recommended)

1. Make sure your phone and computer are on the **same Wi-Fi network**.
2. Open the **Expo Go** app on your phone.
3. Tap **"Scan QR Code"** and scan the code shown in the terminal.
4. The Harmonia app will load on your phone within a few seconds.

---

### Step 3b — Test in a web browser (fallback)

If you don't have a phone available, press **`w`** in the terminal (or click "Run in web browser" in the Expo dev tools). The app opens in your default browser.

> Note: `expo-document-picker` and `expo-sharing` are not available in the browser, so upload and CSV export will be disabled in web mode. All other features (search, filter, playlists, compare, similar tracks) work normally.

---

### Step 3c — Test on an Android emulator

1. Install Android Studio and create a virtual device (AVD).
2. Start the emulator.
3. Press **`a`** in the terminal to open the app on the emulator.

---

### Step 4 — Test the authentication flow

1. On the Login screen, tap **"Register"** and create a new account with a username and password.
2. After registering, you are taken directly to the Library screen.
3. Upload a track using the cloud upload button (top-right of the Library screen).
4. Tap the track to view its analysis (waveform, FFT spectrum, BPM, key).
5. Tap "Log out" (the arrow icon, top-right) to return to the Login screen.
6. Log back in — your track is still there (stored on the server linked to your user ID).

---

### Step 5 — Test the offline fallback

1. Turn off Wi-Fi on your device.
2. Tap the refresh button in the Library header.
3. The status bar shows "⚠ Offline — showing demo tracks".
4. Five demo tracks are displayed so the UI remains usable without a network connection.

---

### Useful terminal shortcuts while the dev server is running

| Key | Action |
|---|---|
| `a` | Open on Android emulator |
| `i` | Open on iOS simulator (macOS only) |
| `w` | Open in web browser |
| `r` | Reload the app |
| `m` | Toggle the developer menu on the device |
| `Ctrl + C` | Stop the server |

---

### Building a production APK for the Play Store

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

This submits a cloud build to Expo's servers and returns a downloadable `.apk` (preview) or `.aab` (store submission) file.

---

*End of document — good luck with your presentation tomorrow!*
