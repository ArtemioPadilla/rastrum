# Tauri Android wrapper

Operator runbook for the Tauri v2 Android build that ships Rastrum to
Google Play Store. The wrapper is a thin native shell around the
existing Astro PWA — `dist/` is loaded by the system WebView (Android
7+), so 99% of the work happens in the regular web codebase. Tauri
adds: AAB packaging, deep-link handling, native push notifications
(future), and the Play Console deploy lane.

> Status: **scaffold landed in #762.** The config files, GH Actions
> workflow, and this runbook ship in-tree. Producing an actual AAB
> requires the Rust + Android SDK + NDK toolchain on the operator's
> machine (or running the CI workflow with the right secrets).

---

## Prerequisites (one-time, local)

1. **Rust toolchain** —
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
2. **Java 17** — Android Gradle Plugin 8.x requires JDK 17.
   ```bash
   brew install --cask temurin@17     # macOS
   sudo apt install openjdk-17-jdk    # Debian/Ubuntu
   ```
3. **Android SDK + NDK** — easiest via Android Studio's SDK Manager:
   - SDK Platforms → Android 14 (API 34) — or the latest target.
   - SDK Tools → NDK (Side by side) — pin a version matching CI
     (`26.1.10909125` today).
   - Build-Tools 34.0.0 + Command-line Tools.
4. **Environment variables** — add to your shell profile:
   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk         # macOS default
   export NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125
   export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
   ```
5. **Tauri CLI** — installed as a devDependency by `npm ci`. Sanity
   check with `npx tauri --version` (should print `tauri-cli 2.x`).

---

## One-time project init

The `src-tauri/` skeleton is already in tree (see #762). The Android
sub-project under `src-tauri/gen/android/` is generated, gitignored,
and produced on first run:

```bash
npm run tauri:android:init
```

That writes `src-tauri/gen/android/` containing the Gradle project,
manifest, and platform mipmaps. Re-run any time you bump the Tauri
CLI or Android SDK.

Brand icons populate from `public/rastrum-logo.svg`:

```bash
npx tauri icon ./public/rastrum-logo.svg
```

This rasterises every required size into `src-tauri/icons/`. Those
PNGs are gitignored (regenerated on demand) until the brand mark is
finalised.

---

## Dev workflow

Plug a USB-debugging Android device or start an AVD emulator, then:

```bash
npm run tauri:android:dev
```

This starts `astro dev` on `http://localhost:4321`, builds the Tauri
shell in dev mode, and pushes the APK to your device. Hot reload is
wired — Astro changes refresh the WebView without rebuilding the
Rust binary.

Common gotchas:

- **`adb devices` empty** → enable USB debugging in Developer Options;
  on macOS plug into a USB-A port (some USB-C cables are charge-only).
- **WebView shows white screen** → the dev server didn't finish
  starting before Tauri loaded the URL. `Ctrl+C`, wait for `astro dev`
  to print the local URL, re-run.
- **CORS errors hitting Supabase** → add the dev origin
  (`http://localhost:4321`) and the WebView origin
  (`https://tauri.localhost` on Android) to your Supabase project's
  redirect allow-list.

---

## Production AAB build

```bash
npm run build              # static dist/
npm run tauri:android:build # AAB under src-tauri/gen/android/app/build/outputs/bundle/
```

Output path:
`src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab`

Or run the GitHub Actions workflow:

```bash
gh workflow run tauri-android.yml --ref main
gh run watch
```

The workflow uploads the resulting AAB as a `rastrum-android-aab`
artifact (14-day retention).

---

## Signing keystore

Play Console requires every AAB to be signed by the same upload key.
Generate it once and store it offline + as a CI secret.

```bash
keytool -genkey -v \
  -keystore release.jks \
  -keyalg RSA -keysize 2048 \
  -validity 10000 \
  -alias rastrum-upload
```

Pick a strong keystore password and a strong key password (they can
match). Save the `release.jks` file in 1Password (or equivalent) — if
it's lost, every future AAB has to be uploaded under a new app
listing.

Encode for GitHub:

```bash
base64 < release.jks | pbcopy
```

Set the following Actions secrets in
`Settings → Secrets and variables → Actions`:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | output of `base64 < release.jks` |
| `ANDROID_KEY_ALIAS` | `rastrum-upload` (matches `-alias` above) |
| `ANDROID_KEY_PASSWORD` | the key password |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |

The `tauri-android.yml` workflow conditionally signs the AAB only
when `ANDROID_KEYSTORE_BASE64` is present, so the workflow still
produces an unsigned AAB for testing while signing is being set up.

---

## Play Store internal-track upload

For v1 the upload is **manual**:

1. Sign in to https://play.google.com/console.
2. Pick the Rastrum app (or create it the first time — set the
   package name to `org.rastrum.app`, matching `tauri.conf.json
   identifier`).
3. Release → Testing → Internal testing → Create new release.
4. Upload the signed AAB.
5. Bump the version code (Tauri sets it from
   `tauri.conf.json -> version` — increment before each release).
6. Submit for review.

A future PR can wire `r0adto/upload-google-play` or `fastlane supply`
into the Actions workflow once the Play Console service-account JSON
is set up.

---

## PWA install banner suppression

When the page is rendered inside the Tauri WebView, the `Install
Rastrum` banner from `InstallPwaButton.astro` and
`InstallDiscoveryHint.astro` would be confusing — the user already
"installed" by downloading the app. Both components short-circuit
their `beforeinstallprompt` handlers when `window.__TAURI_INTERNALS__`
is set (Tauri v2 injects this on every page).

Regression guard: search for `__TAURI_INTERNALS__` and confirm both
files keep the early return whenever the install UX is touched.

---

## Deep links (`rastrum://`)

Out of scope for the v1 scaffold. When ready, follow Tauri's
[deep-linking plugin guide](https://v2.tauri.app/plugin/deep-link/) —
the `org.rastrum.app` identifier is already set, so registering the
scheme is a one-line change to `tauri.conf.json` plus an
AndroidManifest patch generated by `tauri android init`.

---

## Push notifications (FCM)

Out of scope for the v1 scaffold. The PWA already uses Web Push via
VAPID; the Android wrapper inherits that flow inside the WebView and
needs no separate FCM integration unless we ship native widgets that
need server pushes outside the app shell.

---

## Known assumptions / open questions

- **Android 7+ (API 24).** `tauri.conf.json -> bundle.android.minSdkVersion`
  pinned at 24. Bumping requires checking the WebView feature-detection
  path in the existing PWA.
- **NDK version** — pinned at `26.1.10909125` in CI. Updating involves
  bumping both `tauri-android.yml` and any `.ndk_version` doc here.
- **Capabilities** — `src-tauri/capabilities/default.json` only grants
  `core:default`. Adding native plugins (filesystem, geolocation,
  notifications) requires extending this capability set; keep it
  minimal and document each addition.
- **Cargo.lock** — committed (binary crate convention). Do not add it
  to `.gitignore`.
