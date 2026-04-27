# Module 16 — My Observations (Personal History)

**Version target:** v1.0
**Status:** shipped — `/{lang}/profile/observations/` (`/perfil/observaciones/`) live with status + thumbnails.
**GitHub Issue:** #17
**Requested by:** Eugenio Padilla (first user, 2026-04-25)
**Last verified:** 2026-04-26.

---

## Overview

A personal observation list page where authenticated users can review,
track status, and correct their past observations.

---

## Routes

| Lang | Path |
|------|------|
| ES | `/es/perfil/observaciones/` |
| EN | `/en/profile/observations/` |

Also: add "Mis observaciones" link in profile dropdown and mobile menu.

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│ Mis observaciones                    [Exportar CSV]  │
│ 12 registros · 8 especies · 3 sincronizados         │
├─────────────────────────────────────────────────────┤
│ [Todas] [Pendientes] [Sincronizadas] [Sin ID]       │
├─────────────────────────────────────────────────────┤
│ 🌿 Brongniartia argentea                            │
│    San Pablo Etla · 24 abr 2026 · ✅ Sincronizada   │
│    [foto thumbnail]                  [Ver] [Editar] │
├─────────────────────────────────────────────────────┤
│ ❓ Sin identificar                                   │
│    San Pablo Etla · 25 abr 2026 · 📱 Local          │
│    [foto thumbnail]                  [Identificar]  │
└─────────────────────────────────────────────────────┘
```

---

## Data Sources

```typescript
// Dexie (local, unsynced)
const localObs = await db.observations
  .where('observer_kind').equals('user')
  .sortBy('created_at');

// Supabase (synced)
const { data: remoteObs } = await supabase
  .from('observations')
  .select(`
    id, observed_at, created_at, sync_status,
    identifications(scientific_name, confidence, is_primary),
    media_files(url, is_primary)
  `)
  .eq('observer_id', user.id)
  .order('observed_at', { ascending: false });
```

---

## Status Badges

| Badge | Condition |
|-------|-----------|
| ✅ Sincronizada | `sync_status = 'synced'` |
| 📱 Solo en dispositivo | Local Dexie, not synced |
| 🔄 Sincronizando | `sync_status = 'pending'` |
| ❌ Error | `sync_status = 'error'` |
| 🔍 Identificada | Has identification with confidence ≥ 0.4 |
| ❓ Sin ID | No identification or confidence < 0.1 |
| ⭐ Research grade | `is_research_grade = true` |

---

## Acceptance Criteria

- [ ] Page loads list of own observations (local + remote merged)
- [ ] Each card shows: thumbnail, species name or "Sin identificar", date, location, status badge
- [ ] Filter tabs: Todas / Pendientes / Sincronizadas / Sin ID
- [ ] Tap card → observation detail page
- [ ] "Exportar CSV" → triggers Darwin Core export (existing endpoint)
- [ ] Empty state with CTA to /observar
- [ ] Works offline (Dexie local observations always visible)
