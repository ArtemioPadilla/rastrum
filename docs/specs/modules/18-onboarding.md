# Module 18 — Onboarding Flow

**Version target:** v1.0
**Status:** Planned
**Discovered:** First user session with Eugenio Padilla (2026-04-25)

---

## Overview

A guided first-run experience that walks new users through Rastrum's core
features, sets expectations (WebLLM download, GPS permission, camera access),
and gets them to their first observation in under 2 minutes.

---

## Triggers

- First login (no observations yet)
- OR explicit "¿Cómo usar Rastrum?" CTA on profile

---

## Steps

### Step 1 — Bienvenida (30 sec)
- App name, mission statement
- "Rastrum registra la biodiversidad de México — tú eres el científico"
- Language selection (ES / EN / indigenous)
- CTA: "Empezar"

### Step 2 — Permisos (30 sec)
- GPS: "Para registrar dónde viste la especie" → request permission
- Camera: "Para identificar con IA" → request permission
- Notifications: optional

### Step 3 — IA local (60 sec, first time only)
- Explain WebLLM: "Identificamos especies en tu dispositivo — tus fotos no salen de tu celular"
- Show model size warning: ~2.4 GB download
- Options: [Descargar ahora] [Solo PlantNet por ahora] [Usar mi key de Anthropic]

### Step 4 — Primera observación
- Shortcut to /observar with guided tooltips
- Tooltip 1: "Toma o selecciona una foto"
- Tooltip 2: "Espera la identificación automática"
- Tooltip 3: "Confirma o corrige la especie"
- Tooltip 4: "Guarda — se sincroniza automáticamente"

### Step 5 — Perfil
- "Pon tu nombre de usuario" (with validation, ES/EN hint)
- Optional: expertise level, region

---

## Known Pain Points (from Eugenio's session)

- Username field: no validation feedback → raw DB error (fixed in #14/#20)
- No visible species ID field → users confused (fixed in #15)
- Camera button doesn't open camera → workaround explained
- OAuth shows raw Supabase domain → alarming for non-technical users (#3)
- "Guardando…" hung indefinitely (fixed in #13)

---

## Acceptance Criteria

- [ ] New user sees onboarding on first login
- [ ] Permission requests explained in context
- [ ] WebLLM download warning shown with clear size + privacy message
- [ ] User reaches first saved observation within 2 minutes
- [ ] Onboarding can be skipped and restarted from profile
- [ ] Works offline (no network required for steps 1-2)
