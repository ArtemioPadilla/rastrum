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
