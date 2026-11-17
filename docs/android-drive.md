# CTRLpanel Drive for Android

A sideloaded landscape tablet app, package `pro.cwmccann.ctrlpanel.drive`, for Android 8.0+ (API 26). Designed around an 8-inch 1280×800 onn tablet, with compact landscape layouts down to 800×480. It is a standalone dashboard, not an Android Auto or Apple CarPlay receiver.

## Install and connect

1. Transfer `android/app/build/outputs/apk/debug/app-debug.apk` to the tablet and open it. Allow installation from that file manager when Android asks. This is a development-signed build; retain the same signing key for subsequent updates.
2. Sign in with the same email/password used for CTRLpanel. The APK includes the interface; it does not require deploying `/drive` to the website first. Internet access is needed to sign in and sync.
3. Install Google Maps and Spotify on **this tablet** and sign into them. Keep your existing phone-to-tablet location-sharing app running over the hotspot; Drive uses the Google Maps navigation it already enables. Drive does not request GPS permission or replace that location setup.
4. While parked, tap **Allow access** on the Next turn or Spotify card (or Display settings → Enable app access). Android opens notification-access settings (Drive's own toggle on Android 11+); enable **CTRLpanel Maps & Spotify**, then return to Drive. Without it both cards stay empty: Maps turns come from its notification and Spotify's media session is only visible to apps with notification access. Some Android builds restrict notification listeners, especially low-memory/Go devices; Drive then says so in the cards.

   Drive reports access as *granted* separately from the listener being *connected*. When Android drops the listener (after an APK update or when it kills the app on a low-memory tablet) while access stays on, Drive asks Android to rebind it on resume and at most every 15 seconds while open, and the Next turn card shows "Reconnecting…" meanwhile. If it never reconnects, switch the toggle off and on again.
5. Start a route in Google Maps and music in Spotify, then return to Drive using Android's recent-apps button/gesture. Drive stays awake while foregrounded, supports either landscape orientation, and hides the system bars until swiped in.

Android may require allowing restricted settings from the app-info menu before notification access can be enabled for a sideloaded app. Update Android System WebView if app controls are unavailable.

## Displays

- **Cockpit:** Maps directions at top left, Spotify at top right, configurable circular center, task and habit summaries below.
- **Music:** larger dedicated Spotify view with previous/play-pause/next.
- **My CTRLpanel:** due/overdue tasks and today's habit completion, plus up to three task/habit names.
- Swipe left/right over the display or use the bottom page buttons. Swipes on controls and vertical scrolling do not switch pages.
- Choose digital, analog, or minimal clocks; Maps directions; Spotify; CTRLpanel tasks; or CTRLpanel habits in Display settings. The selected face saves to `ui_preferences.drive` through the existing atomic preferences RPC.

The native apps' entire screens cannot be embedded here. Maps is represented by the text of its current ongoing navigation notification, where the installed Maps version supplies the navigation category. No route is invented if it does not. “Open Maps” opens the full app. Spotify uses the tablet's active media session; playback controls stay disabled until a session exists. Playback rights/skip limits still follow Spotify. No Spotify client credentials or Google Maps API key are required for these integrations.

## Sync and privacy

Uses the existing public Supabase client, authentication and RLS. No service-role key, new table or migration. Tasks, boards, active habits and today's habit logs refresh on resume, reconnect, manual refresh and every 60 seconds while visible. Reads are bounded to 500 rows per table to suit a low-power device; summaries cover that fetched set. Nothing creates example user rows. Data stays in memory and is cleared when the signed-in user changes. A failed refresh retains the last values with a visible sync-paused state and Retry. Only display settings are editable in Drive; full editing is available through Open full CTRLpanel.

The APK's WebView serves bundled code at the existing HTTPS application origin, so `/api` remains same-origin. Only packaged assets and the packaged shell are served locally. No web service worker runs in the APK. External web navigation opens outside the WebView. Native commands use an origin-restricted AndroidX message listener, accept only the main `/drive` frame and a fixed command allowlist, and never receive auth tokens. File/content access, mixed content, third-party cookies and Android backups are disabled. Other apps' notifications are ignored; Maps text and Spotify metadata are never written to disk or sent to CTRLpanel.

## Build

Install JDK 17 and Android SDK platform/build-tools 35. Set `JAVA_HOME` and `ANDROID_HOME`, then from the repository root:

```powershell
npm ci
npm run android:assets
cd android
.\gradlew.bat assembleDebug lintDebug
```

The Gradle wrapper pins 8.11.1; Android Gradle Plugin pins 8.9.2, AndroidX WebKit pins 1.12.1. The APK assets are generated and ignored. The tablet's separate Vite entry excludes desktop charts, editors and dashboard providers. Build a signed release in Android Studio for ongoing distribution; keep the signing key private and stable, and increment `versionCode` for updates. Never commit keystores. Web changes require rebuilding/reinstalling the APK; synced database changes do not.

If OneDrive or antivirus locks Gradle's immutable caches, set `GRADLE_USER_HOME` to a temporary/local directory outside OneDrive and use `--project-cache-dir` outside OneDrive too.

## Version 0.1.1 reliability update

Requests time out after 15 seconds so a stalled hotspot connection cannot indefinitely block refresh. Backgrounding the Android activity cancels in-flight data requests; returning from Maps/Spotify explicitly refreshes data and settings. Account changes hide the prior user's snapshot immediately. A visible partial-view notice appears if any source exceeds 500 records. Version code 2 updates the original development-signed APK in place using the same signing key.

## Verification

Run `npm test`, `npm run build`, and `npm run android:assets`. `tests/drive.test.mjs` covers swipe intent/bounds, custom task completion, local-day habit totals and the native command allowlist. Browser fixture checks cover empty states, face changes, page navigation and landscape/portrait sizing without touching production data.

Required hardware checks: sideload and sign-in, permission grant/revoke, a real Maps route starting/ending, Spotify playback/skip, switching apps and returning, loss/restoration of internet, screen rotation and logout/account change. Browser checks cannot establish hardware compatibility or GPS availability. Configure displays while parked.

References: [Android media sessions](https://developer.android.com/reference/android/media/session/MediaSessionManager), [Google Maps intents](https://developers.google.com/maps/documentation/android-sdk/intents), [AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit).
