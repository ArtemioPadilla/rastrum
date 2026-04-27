# Module 15 — Map Location Picker

**Version target:** v1.0
**Status:** shipped — drag-pin + tap-to-place + locality search wired into `ObservationForm.astro`.
**GitHub Issue:** #9
**Requested by:** Eugenio Padilla (first user, 2026-04-25)
**Last verified:** 2026-04-26.

---

## Overview

Replace the raw coordinates display in the observation form with an interactive
MapLibre map widget. The user sees their GPS pin immediately and can drag it
to adjust accuracy, or tap anywhere to relocate.

---

## UX Flow

### Flow A — GPS available
1. Page loads → GPS coarse fix appears as pin on mini map (~3 seconds)
2. Mini map shows 200×200px thumbnail in ObservationForm
3. GPS refines in background → pin moves, accuracy circle shrinks
4. User can tap map to expand full-screen picker
5. Drag pin to correct location → coordinates update

### Flow B — Manual / Camera trap
1. No GPS → map shows last known location or region center (Oaxaca)
2. Search field: type locality name → map centers
3. Tap to place pin → coordinates fill

### Flow C — Offline
1. Cached pmtiles (v0.3) → map renders offline
2. Falls back to coordinate text input if tiles not cached

---

## Component Design

```
ObservationForm
  └── LocationPickerMap (new component)
        ├── <div id="location-mini-map"> 200×200px MapLibre instance
        ├── Accuracy circle overlay
        ├── "Ajustar" button → expands to full-screen modal
        ├── FullScreenMapModal
        │     ├── Full MapLibre map
        │     ├── Crosshair center pin
        │     ├── Search input (Nominatim / local)
        │     └── "Confirmar ubicación" button
        └── Coordinate display (lat, lng, ±accuracy, source badge)
```

---

## Implementation Notes

- MapLibre already used in `ExploreMap.astro` — reuse same tile config
- Mini map: `new Map({ container, style, interactive: false })` + marker
- Full-screen: `interactive: true` + `map.on('move', updateCoords)`
- Nominatim endpoint: `https://nominatim.openstreetmap.org/search`
- No API key required for either MapLibre (OpenFreeMap) or Nominatim

---

## Acceptance Criteria

- [ ] Mini map thumbnail visible in ObservationForm on location section
- [ ] GPS pin appears within 5 seconds on Android Chrome
- [ ] User can tap to expand full-screen map picker
- [ ] Drag/tap updates coordinates in real time
- [ ] Search field finds oaxacan localities
- [ ] Works offline with cached pmtiles (v0.3+)
- [ ] Accessibility: keyboard navigable, screen reader label
