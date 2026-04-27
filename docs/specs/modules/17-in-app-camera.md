# Module 17 — In-App Camera (getUserMedia)

**Version target:** v1.0 → reverted, deferred to v1.1
**Status:** **deferred.** A getUserMedia modal was prototyped during the v1.0 push but removed before launch — the live preview added latency, the captured frames were lower resolution than the OS camera, and the system camera (`<input type="file" capture="environment">`) was more reliable on the devices we tested. The /observe form ships with two buttons: **'Take photo'** (system camera via the capture attribute) and **'Upload from gallery'**.
**GitHub Issue:** #18 (open — Android Chrome quirk where `capture` is ignored on some devices/skins)
**Requested by:** Eugenio Padilla (first user, 2026-04-25)
**Last verified:** 2026-04-27.

When v1.1 brings this back, it should ship as a **secondary** path (button labeled "In-app camera (preview)" or similar) with the system camera as primary, so users on devices where `capture=environment` works keep the higher-resolution OS camera.

---

## Overview

Replace `<input type="file" capture="environment">` (which Android ignores
on many devices) with a proper in-app camera using the `getUserMedia` API.
Shows a live viewfinder in the observation form.

---

## Why

`capture="environment"` is inconsistently implemented across Android browsers.
On many devices it opens the file picker instead of the camera directly.
`getUserMedia` gives us direct camera access with a live preview.

---

## UX Flow

1. User taps "Usar cámara" button
2. **Camera permission prompt** appears (browser native)
3. Live viewfinder opens (full-screen overlay)
4. Rear camera selected by default (`facingMode: 'environment'`)
5. Tap shutter button → captures frame as JPEG Blob
6. Preview thumbnail appears in photo grid
7. Camera closes

---

## Implementation

```typescript
// Camera capture via getUserMedia
async function openInAppCamera(): Promise<File | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 3072 } }
    });
    // Show viewfinder modal with <video> element
    // On capture: canvas.drawImage(video) → canvas.toBlob() → File
    return capturedFile;
  } catch (err) {
    // Fallback to file input
    cameraInput.click();
    return null;
  }
}
```

---

## Fallback Chain

1. `navigator.mediaDevices.getUserMedia` → in-app viewfinder ✅
2. `<input capture="environment">` → may open camera on some devices
3. `<input type="file" accept="image/*">` → always works (gallery picker)

---

## Acceptance Criteria

- [ ] "Usar cámara" opens live viewfinder on Android Chrome
- [ ] Rear camera selected by default
- [ ] Shutter button captures full-resolution photo
- [ ] EXIF GPS preserved from device location at capture time
- [ ] Graceful fallback to file input if getUserMedia denied/unavailable
- [ ] Works on iOS Safari (getUserMedia supported since iOS 11)

---

## Re-introduction path (planned for v1.1)

This section captures the design for re-introducing the `getUserMedia`
camera as a **secondary** path alongside the primary system-camera
button. No code lands yet — this is the contract the v1.1 work should
follow so that the v1.0 surface continues to work unchanged for users
who never opt in.

### Surface

- The /observe form keeps **"Take photo"** (system camera, `<input
  type="file" capture="environment">`) as the primary, default-visible
  button.
- A new **secondary button labeled "Cámara con vista previa"** ("Camera
  with preview" in EN) appears next to it. It is gated on a settings
  toggle so users on devices where the system camera works well never
  see the alternative button at all.

### Settings toggle

- Add a single boolean preference under user settings (the existing
  `localStorage` settings store, not Supabase) — e.g.
  `rastrum.prefs.useInAppCamera` (default `false`).
- Surface the toggle in the **Preferences** section of the settings
  drawer / profile page with a short explainer:
  "Show an extra camera button that opens a live preview inside the app.
  Useful on Android devices where the system camera ignores the rear-
  camera hint."
- When `false` (default), the secondary button is hidden — the form
  renders exactly the v1.0 surface.

### Bundle / dependency budget

- **Zero extra dependencies.** `getUserMedia`, `MediaStream`,
  `<canvas>.toBlob()`, and `URL.createObjectURL` are platform APIs.
- The viewfinder modal is implemented inline in `ObservationForm.astro`
  the same way the existing `id-spinner` / `phi-offer` blocks are —
  hidden DOM with a small inline script, no React, no media library.
- Keep the modal CSS under ~1 KB by reusing existing Tailwind utility
  classes from the rest of the form.

### Fallback chain

The secondary button must degrade gracefully on every step:

1. `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`
   → success → live viewfinder modal.
2. `getUserMedia` rejects with `NotAllowedError` (user denied) or
   `NotFoundError` (no camera) → close modal, **fall back to the system
   camera** (programmatically click the existing primary "Take photo"
   `<input>`) and surface a one-time toast: "Camera preview blocked —
   using system camera instead. You can change this in Settings."
3. `mediaDevices` is undefined (insecure context, ancient browser) →
   the secondary button is not rendered at all (feature-detect at
   mount time).

### Capture pipeline

- Live `<video>` element on the modal, sized to viewport with `object-fit: cover`.
- Shutter button draws the current frame onto an off-screen `<canvas>`
  at the stream's native resolution (`videoWidth × videoHeight`),
  then `canvas.toBlob('image/jpeg', 0.92)`.
- Convert the resulting `Blob` to a `File` so it slots into the
  existing `addPhotos()` flow without changes to downstream code.
- Stop all stream tracks (`stream.getTracks().forEach(t => t.stop())`)
  before closing the modal — release the camera even if the user
  navigates away.

### EXIF / GPS

- `getUserMedia` frames have **no EXIF** (the browser doesn't write
  one). The existing geolocation step (`navigator.geolocation`) still
  fires on form submit, so the observation row gets coordinates from
  the device, not the photo. This matches today's behaviour for users
  who upload from gallery.
- If a future iteration wants in-frame EXIF, that's a separate piece
  of work (would need to write our own EXIF chunk into the JPEG bytes
  before handing to `addPhotos`) — out of scope for v1.1.

### Tests

- Unit-test feature detection helper (`canUseInAppCamera()`) for the
  three cases (unsupported / denied / supported).
- Add a Playwright e2e step that flips the toggle, asserts the second
  button is visible, mocks `getUserMedia` to reject, and verifies the
  fallback fires.

### Out of scope for v1.1

- Front-facing camera toggle.
- Resolution/quality picker.
- Pinch-to-zoom or tap-to-focus (Android Chrome doesn't expose
  `ImageCapture.takePhoto` reliably enough yet).
- Replacing the primary "Take photo" button — system camera stays as
  the default forever.
