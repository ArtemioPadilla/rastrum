# Observation form redesign — Fogg-aligned ability + celebration

**Date:** 2026-05-10
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Related modules:** 03 (observations / media files), 13 (identifier registry / cascade), 26 (social — reactions / share), 27 (establishment means), v1.1.5 Persuasive Tech audit (algorithms registry, honest norms, photo praise).
**Related files:** `src/components/ObserveView2.astro` (1171 LOC), `src/components/DropZone.astro`, `src/components/ContextualSpeciesChips.astro`, `src/components/ActiveObserversBanner.astro`, `src/lib/algorithms.ts`, `supabase/functions/identify/index.ts`, `public.suggest_nearby_species()` (schema.sql:10842).

---

## Goals

1. **Subir habilidad** (Fogg): hacer que la conducta primaria — *dropear / capturar una foto* — gane el primer pliegue. Hoy hay siete bloques de chrome compitiendo con el dropzone; la propuesta los reduce a uno (header).
2. **Convertir el pipeline en `facilitator`**: reemplazar el grafo SVG de cinco nodos con un stepper lineal de tres pasos que mantiene motivación durante la espera con tiempos honestos. Conservar el detalle on-tap para usuarios curiosos.
3. **Filtrar y diferir "Probable here"**: las sugerencias se mueven de pre-acción (sesgo + privacidad) a post-GPS, sin thumbnails de fotos de extraños y sin domésticos / cultivadas (`establishment_means = 'wild'`).
4. **Convertir el `success state` en celebración + trigger del siguiente** (Tiny Habits): foto grande, línea verificable de logro, dex progress, "Registrar otra" como botón primario en vez de link gris.
5. **Consolidar las cinco salidas** ("Skip location", "Skip identification", "Save without ID", "Save without identification", "Just identify, don't save") en dos: `Guardar` y `Guardar sin identificación`. Hick's Law + Fogg ético.
6. **Defaults inteligentes**: la app recuerda último hábitat, último weather, última licencia y los pre-rellena. Sube habilidad eliminando trabajo repetido.

## Non-goals

- Reescribir el `identify` Edge Function ni la lógica de cascada de identificadores (módulo 13). El rediseño es puramente client-side / view + un cambio menor en el RPC `suggest_nearby_species`.
- Retirar el formulario clásico (`/observe/classic`). Permanece como fallback. El link en el header se mueve a settings.
- Cambios de schema de tablas. Solo se ajusta una función SQL existente y se añaden dos columnas opcionales para la memoria de defaults (en `users`).
- Touchear el flujo `?mode=identify` (identify-only) más allá de quitar el botón "Just identify, don't save" — el modo se mantiene como ruta separada gobernada por un solo botón secundario.
- Eliminar el "Active observers" banner. Solo se mueve al pie y se oculta correctamente cuando `{region}` no resuelve.
- Refactor del `ObserveView2.astro` monolítico (1171 LOC) más allá de lo que el rediseño exige. Una limpieza completa es un v1.1 follow-up.
- Cambios en el Photo crop modal (#787) — vive sin tocarse.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Orden visual | **Header → Dropzone hero → todo lo demás aparece tras dropear archivo** | Habilidad de Fogg: el ROI más alto del rediseño (~70%) viene de eliminar pre-roll. |
| Capability banner | **Eliminar como banner; reemplazar por caption de 1 línea al pie con framing positivo** ("PlantNet + Cloud AI listos · configurar más") | La versión actual con 4 ❌ contra 2 ✅ lee como "tu app está rota." |
| AI source selector | **Ocultar cuando solo hay una opción usable**; mostrar caption en su lugar. Si hay 2+, mostrar segmented control sin botones disabled. | Disabled buttons leen como bug. Hick's Law. |
| "Probable here" | **Mover a post-GPS** (estado 3 del flujo) + **filtrar `establishment_means != 'wild'`** + **eliminar thumbnails de fotos de extraños** | (a) Pre-acción sesga la observación. (b) Thumbnails de extraños = problema de privacidad / framing. (c) Perros y plantas cultivadas socavan el propósito de biodiversidad. |
| Pipeline visualización | **Stepper lineal de 3 pasos (Foto → Identificar → Guardar) con tiempos honestos**; tap en paso abre detalle del nodo | Grafo SVG con 5 nodos + aristas dashed es engineer-coded. Stepper es Fogg facilitator. |
| Caminos de salida | **Dos botones: `Guardar` (primario) + `Guardar sin identificación` (secundario)**. Eliminar "Skip location" inline + "Just identify don't save" + "Save without ID" del no-runners | Hick's Law. La opción identify-only sigue accesible vía `/observe?mode=identify`. |
| `?mode=identify` flow | **Conservar la ruta** + el bloque `obs2-identify-result` post-pipeline. Ya no se cuelga del save button | El modo es legítimo (uso ad-hoc); el problema era el link redundante en el form normal. |
| Success state | **Reemplazar `✅ Observation saved!` + link gris por: foto grande + línea verificable + dex progress + botón primario "Registrar otra"** | Tiny Habits: la celebración crea el hábito. El siguiente trigger debe ser el botón principal, no un link. |
| Línea de logro | **Solo mostrar afirmaciones verificables** (n≥50 invariante v1.1.5). "Tu observación #43" siempre OK; "Primera en este sector hoy" solo si la query lo confirma. | Honest norms. No fabricar urgencia. |
| Dex progress | **Mostrar `+1 · {familia/clase}`** + barra de progreso del dex personal (cuando aplica). Sin gamificación tóxica (no rachas con shame, no leaderboard). | Maestría como motivación honesta. |
| Defaults memory | **Persistir `last_habitat`, `last_weather`, `last_license` en `users`** y pre-rellenar en el siguiente formulario | Sube habilidad. Cero costo. Editable por defecto. |
| Active observers banner | **Mover al pie del form**; ocultar cuando `{region}` no resuelve | El copy roto (`"in  yet today"`) hoy se ve por defecto. |
| Header "Classic form" link | **Mover a settings** (`/profile/edit`); o si se queda visible, agregar tooltip explicando cuándo usarlo | Sugiere que el rediseño es provisional. |
| Contextual hint inline | **Eliminar** ("PlantNet will identify plants and fungi...") | Redundante con el capability caption. |
| "Edit identification" link | **Eliminar** | El input manual ya está siempre visible debajo. |
| WhyAmISeeingThis pills | **Conservar exactamente** en active-observers + contextual chips + cualquier nuevo surface ranked. Registrar nueva entrada en `algorithms.ts` si se añade un surface. | Invariante v1.1.5 #1 — no negociable. |
| Photo praise | **No tocar** (`pickPraise(exif)` sigue invocándose en upload). Es taxon-agnostic, EXIF-only. | Invariante v1.1.5 #4. |

---

## Layout

### Mobile (`< md:`)

Estado 1 — abrir la página (cero archivos):

```
┌────────────────────────────────────┐
│ Header: "Log observation"          │
├────────────────────────────────────┤
│                                    │
│        ┌──────────────┐            │
│        │      📷      │            │
│        │              │            │
│        │  Drop / Tap  │            │
│        │              │            │
│        │ [📷] [🖼️] [🎤] │            │
│        └──────────────┘            │
│                                    │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ PlantNet + Cloud AI listos ·       │
│ configurar más                     │
└────────────────────────────────────┘
```

Estado 2 — archivo dropeado, pipeline corriendo:

```
┌────────────────────────────────────┐
│ Header: "Log observation"          │
├────────────────────────────────────┤
│ [▣]  thumb strip                   │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ ✓ ─ ⟳ ─ 3                    │   │
│ │ Foto Identif. Guardar        │   │
│ │ Identificando con PlantNet…  │   │
│ │ ~4s                          │   │
│ └──────────────────────────────┘   │
│                                    │
│ "Toca el paso para detalles"       │
└────────────────────────────────────┘
```

Estado 3 — pipeline listo:

```
┌────────────────────────────────────┐
│ Header                             │
├────────────────────────────────────┤
│ [▣]  thumb strip                   │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ Bidens pilosa                │   │
│ │ Aceitilla · 92% · PlantNet   │   │
│ │ ¿Por qué esta especie?       │   │
│ └──────────────────────────────┘   │
│                                    │
│ Probable aquí · ¿Por qué?  [i]     │
│  [Bidens pilosa] [Salvia mex.]     │
│  [Tagetes lunulata]                │
│                                    │
│ Scientific name (input)            │
│                                    │
│ 📍 19.3751, −99.1902 (±35m)        │
│ Pick on map →                      │
│                                    │
│ Notes (textarea)                   │
│                                    │
│ ▸ Advanced fields                  │
│                                    │
│ ┌──────────────────────────────┐   │
│ │       Guardar observación    │   │
│ └──────────────────────────────┘   │
│ Guardar sin identificación         │
└────────────────────────────────────┘
```

Estado 4 — guardado:

```
┌────────────────────────────────────┐
│ Header                             │
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │
│ │                              │   │
│ │         [foto grande]        │   │
│ │                          ✨  │   │
│ └──────────────────────────────┘   │
│                                    │
│      ¡Tu observación #43! 🎉       │
│         Bidens pilosa              │
│ Primera en este sector hoy         │
│ ✓ Research-grade-ready             │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ Profile-dex: 64 / 100        │   │
│ │ ████████████████░░░░░░░░     │   │
│ │ +1 · Asteraceae              │   │
│ └──────────────────────────────┘   │
│                                    │
│ ┌──────────────────────────────┐   │
│ │     📷  Registrar otra       │   │
│ └──────────────────────────────┘   │
│ Compartir · Ver detalle            │
└────────────────────────────────────┘
```

### Desktop (`md:` y arriba)

Mismo orden vertical, pero con `max-w-2xl mx-auto` (igual que hoy). El form es de input, no de browsing — un layout de dos columnas no aporta. Lo único que cambia en desktop:

- El stepper se beneficia del ancho extra mostrando los labels completos sin truncate.
- "Probable here" puede mostrar 5 chips en una fila en vez de 3.
- Success state puede mostrar la foto a `max-h-[40vh]` en vez de `h-[180px]`.

No se introduce un sidebar ni layout multi-columna en desktop.

---

## Componentes nuevos / modificados

### `src/components/ObserveView2.astro` (modificado, ~1171 LOC hoy)

Reorganización del orden de bloques. **Sin extraer subcomponentes** en este PR — el refactor a sub-componentes es un v1.1 follow-up porque cualquier extracción ahora colide con el rediseño visual. La lógica del state machine (capability check, AI mode, pipeline events) se conserva intacta. El cambio es en el orden de los bloques HTML y en qué condiciones los muestran.

Nuevo orden de bloques en el template (top → bottom):

1. Resume in-progress banner (sin cambio)
2. Header (`Log observation` H1; el "Classic form" link se mueve a settings — ver i18n más abajo)
3. **Drop Zone** (sin cambio interno; sube en el orden)
4. AI capability caption (1 línea, framing positivo) — *después* del dropzone
5. Pipeline section (con stepper en lugar del SVG graph — ver `PipelineStepper.astro` abajo)
6. Audio-skipped warn (sin cambio)
7. Post-process form (`obs2-post-form`) — secciones internas:
   - ID card + "Why this species?" (sin cambio)
   - Manual taxon input (sin cambio; el "Edit identification" link se elimina)
   - **`ContextualSpeciesChips.astro` aquí** — movido desde arriba; renderiza solo cuando `gpsResolved === true`
   - Location field
   - Notes
   - Advanced fields collapsed
   - Save primary + Save-without-id secondary (consolidado)
8. Identify-only result (sin cambio, solo se accede vía `?mode=identify`)
9. No-runners empty state (sin cambio interno; se simplifican los CTAs internos)
10. **Success state — reemplazo completo** (ver `ObservationSuccess.astro` abajo)
11. Active observers banner (movido al pie; oculto si `{region}` no resuelve)

### `src/components/PipelineStepper.astro` (nuevo, ~120 LOC objetivo)

Stepper horizontal de 3 pasos con estado activo, label y tiempo honesto. API:

| Prop | Type | Notes |
|---|---|---|
| `lang` | `'en' \| 'es'` | i18n |
| `steps` | `Array<{ id: 'photo' \| 'identify' \| 'save'; state: 'pending' \| 'active' \| 'done' \| 'failed'; estimateSeconds?: number }>` | Pasados desde el state machine actual |
| `tapForDetailsHandler` | callback opcional | Re-emite el evento que abre el detail tooltip del grafo viejo |

Renderiza:
- Tres dots (24px) conectados por líneas
- Dot `done`: verde con ✓
- Dot `active`: azul con anillo de pulso (≈ 4px box-shadow)
- Dot `pending`: gris con número
- Dot `failed`: rojo con ✗ (rare path)
- Status line debajo: "Identificando con PlantNet… ~4s" (i18n + interpolación)
- Tap en cualquier dot dispara `tapForDetailsHandler(stepId)` que abre el detalle del nodo (reutilizando el HTML del tooltip existente).

El ESCAPE hatch ("Saltar identificación y continuar" después de 15s) se conserva intacto, fuera del stepper.

El SVG graph del componente actual se conserva en código pero **detrás de un feature flag** `PUBLIC_OBSERVE_PIPELINE_GRAPH` (default off). Si surge una regresión grave en el stepper, basta `PUBLIC_OBSERVE_PIPELINE_GRAPH=1` en el env de Cloudflare Pages para volver al grafo sin redeploy.

### `src/components/ObservationSuccess.astro` (nuevo, ~180 LOC objetivo)

Reemplaza el div `obs2-success` actual (que es 6 líneas de markup). API:

| Prop | Type | Notes |
|---|---|---|
| `lang` | `'en' \| 'es'` | i18n |
| `observationId` | `string` | UUID de la obs recién guardada |
| `photoUrl` | `string \| null` | Cover photo de la obs (o null si solo audio) |
| `taxonScientificName` | `string \| null` | El primary taxon, o null si "Save without ID" |
| `userObservationCount` | `number` | El #43 — count actual del observador |
| `firstInSector` | `boolean` | true solo si la query confirma (n≥50 honesty) |
| `dexProgress` | `{ count: number; total: number; family: string \| null } \| null` | null si el dex no aplica |

Renderiza el storyboard del estado 4 visto en el visual companion:
- Foto al top (160-180px height en mobile, 320px max en desktop) con overlay sutil ✨ esquina sup-derecha
- Línea verificable: `¡Tu observación #{count}! 🎉` + scientific name italic
- Sub-línea condicional: "Primera en este sector hoy · ✓ Research-grade-ready" — solo se renderizan los strings que aplican
- Dex progress card (skip si null)
- Botón primario "Registrar otra" (`min-h-[48px]`, mismo styling que el save button) — re-monta el form en estado 1
- Footer links: "Compartir · Ver detalle" (text-xs, color zinc-400)

**Verificable-claim guardrails** (invariante v1.1.5 #3 honest norms):
- `firstInSector` requiere una query que devuelva `true` solo si `count(observations) WHERE st_dwithin($point, location, 1000) AND date_trunc('day', observed_at) = current_date AND id != $newObsId = 0`. El cliente no puede inflar el flag.
- `Research-grade-ready` requiere que la primary identification tenga `confidence >= 0.7` y exista al menos una `media_files` row con MIME `image/*`. Si no, no se muestra.
- `dexProgress.family` es `null` si el primary taxon no tiene familia clasificada. En ese caso se muestra solo `+1` sin el nombre.

### `src/lib/observation-defaults.ts` (nuevo, ~80 LOC)

Helpers para persistir y leer los defaults del usuario.

```ts
export type ObservationDefaults = {
  habitat: string | null;
  weather: string | null;
  licenseCode: 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0' | null;
};

export async function getObservationDefaults(userId: string): Promise<ObservationDefaults>;
export async function setObservationDefaults(userId: string, partial: Partial<ObservationDefaults>): Promise<void>;
```

La fuente de verdad es `users.last_observation_defaults` (jsonb, ver schema delta abajo). El client llama `getObservationDefaults` al renderizar el form y pre-rellena los `<select>`s. Después de un save exitoso, `setObservationDefaults` persiste solo los campos que el usuario tocó (no los nulls / defaults).

Cero localStorage; los defaults sincronizan entre dispositivos vía Supabase. Cero costo (es un único campo jsonb en `users`).

---

## Cambios de schema

### `users.last_observation_defaults`

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_observation_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.last_observation_defaults IS
  'Last-used habitat / weather / license_code from /observe form. '
  'Pre-fills the next observation form. Pure UX cache; never authoritative.';
```

No se necesita índice — el campo es scalar-per-user y se lee únicamente vía `auth.uid() = id`. RLS existente sobre `users` cubre lectura/escritura.

### `suggest_nearby_species` — añadir filtro `establishment_means = 'wild'`

```sql
-- Reemplaza la función existente. Solo cambia las dos CTEs (`user_observed`
-- y `nearby`) para filtrar `o.establishment_means = 'wild'`.
CREATE OR REPLACE FUNCTION public.suggest_nearby_species(
  p_user_id   uuid,
  p_lat       double precision,
  p_lng       double precision,
  p_month     integer,
  p_radius_km integer DEFAULT 50,
  p_limit     integer DEFAULT 10
)
RETURNS TABLE (
  taxon_id        uuid,
  scientific_name text,
  common_name_es  text,
  common_name_en  text,
  kingdom         text,
  class           text,
  nearby_count    bigint,
  photo_url       text
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH user_observed AS (
    SELECT DISTINCT i.taxon_id
    FROM public.observations o
    JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
    WHERE o.observer_id = p_user_id
      AND o.establishment_means = 'wild'
      AND i.taxon_id IS NOT NULL
  ),
  nearby AS (
    SELECT
      i.taxon_id,
      count(*) AS nearby_count
    FROM public.observations o
    JOIN public.identifications i ON i.observation_id = o.id AND i.is_primary
    WHERE o.sync_status = 'synced'
      AND o.location IS NOT NULL
      AND o.establishment_means = 'wild'
      AND ST_DWithin(
            o.location::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            p_radius_km * 1000
          )
      AND EXTRACT(MONTH FROM o.observed_at) = ANY(
            ARRAY[
              ((p_month - 2 + 12) % 12) + 1,
              p_month,
              (p_month % 12) + 1
            ]
          )
      AND i.taxon_id IS NOT NULL
      AND i.taxon_id NOT IN (SELECT taxon_id FROM user_observed)
    GROUP BY i.taxon_id
    ORDER BY nearby_count DESC
    LIMIT p_limit * 3
  )
  SELECT
    t.id          AS taxon_id,
    t.scientific_name,
    t.common_name_es,
    t.common_name_en,
    t.kingdom,
    t.class,
    n.nearby_count,
    NULL::text AS photo_url  -- v1: ya no devolvemos thumbnails de fotos de extraños
  FROM nearby n
  JOIN public.taxa t ON t.id = n.taxon_id
  ORDER BY n.nearby_count DESC
  LIMIT p_limit;
$$;
```

Dos cambios sustantivos:

1. **`AND o.establishment_means = 'wild'`** en ambas CTEs. Excluye `cultivated`, `captive`, `uncertain`. Esto saca al perro doméstico (`Canis familiaris`) y a la *Gerbera* del jardín de las sugerencias.
2. **`photo_url` siempre `NULL`** en v1. El componente `ContextualSpeciesChips.astro` debe degradar gracefully cuando `photo_url` es null (renderizar un fallback de color o un emoji por kingdom; ver i18n abajo). Esto resuelve el problema de privacidad / framing de mostrar fotos de extraños.

`REVOKE` / `GRANT` actuales se preservan idénticos; no es necesario re-emitirlos para `CREATE OR REPLACE`.

### Nuevas funciones helper para el success state

#### `is_first_in_sector(p_obs_id uuid)` — n≥50 honest claim

```sql
CREATE OR REPLACE FUNCTION public.is_first_in_sector(p_obs_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH this_obs AS (
    SELECT location, observed_at
    FROM public.observations
    WHERE id = p_obs_id
  )
  SELECT
    -- Honest-norms invariante: solo true si el sector tiene actividad
    -- significativa (n≥50 obs históricas en 1 km), si no NULL=false.
    CASE
      WHEN (
        SELECT count(*)
        FROM public.observations o, this_obs t
        WHERE o.location IS NOT NULL
          AND ST_DWithin(o.location::geography, t.location::geography, 1000)
          AND o.id != p_obs_id
      ) < 50 THEN false
      ELSE NOT EXISTS (
        SELECT 1
        FROM public.observations o, this_obs t
        WHERE o.location IS NOT NULL
          AND ST_DWithin(o.location::geography, t.location::geography, 1000)
          AND date_trunc('day', o.observed_at) = date_trunc('day', t.observed_at)
          AND o.id != p_obs_id
      )
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_first_in_sector(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_first_in_sector(uuid) TO authenticated;
```

#### `get_user_observation_count(p_user_id uuid)` — el "#43"

Ya existe efectivamente: el cliente puede leerlo del campo cacheado `users.observation_count` (denormalizado por trigger en módulo 28 community discovery). Si la columna no existe todavía, se añade:

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL DEFAULT 0;
```

(Verificar primero si el cron de community-discovery ya popula esta columna; si sí, no se necesita schema delta.)

### RLS

Ningún cambio. Las dos funciones nuevas son `SECURITY DEFINER` con `REVOKE FROM PUBLIC` y `GRANT TO authenticated` — patrón estándar (invariante #2 de "Schema security invariants" en CLAUDE.md). El `last_observation_defaults` sobre `users` hereda RLS de la tabla.

---

## i18n

Las nuevas strings van bajo el namespace `obs_form_v2.*` para no chocar con el `observe.*` ya existente y consumido por la versión clásica.

```jsonc
"obs_form_v2": {
  "header_title": "Log observation",
  "capability_caption": {
    "ready_one": "{provider} listo · {action}",
    "ready_many": "{providers} listos · {action}",
    "configure_more": "configurar más",
    "no_providers": "Configura un identificador para reconocer especies automáticamente"
  },
  "stepper": {
    "labels": { "photo": "Foto", "identify": "Identificar", "save": "Guardar" },
    "status_running": "{action} con {provider}…",
    "estimate_seconds": "~{n}s",
    "tap_for_details": "Toca el paso para detalles"
  },
  "probable_here": {
    "title": "Probable aquí",
    "subtitle": "Estimación basada en observaciones cercanas. La precisión mejora con más datos.",
    "empty": "Aún no hay datos suficientes en esta zona para sugerir especies.",
    "fallback_kingdom_emoji": {
      "Plantae": "🌿", "Animalia": "🐾", "Fungi": "🍄", "Bacteria": "🦠", "Protista": "🦠",
      "Chromista": "🦠", "Archaea": "🦠", "_default": "🌍"
    }
  },
  "save_primary": "Guardar observación",
  "save_without_id": "Guardar sin identificación",
  "success": {
    "title": "¡Tu observación #{n}! 🎉",
    "first_in_sector": "Primera en este sector hoy",
    "research_grade_ready": "✓ Research-grade-ready",
    "dex_label": "Profile-dex: {count} / {total}",
    "dex_increment": "+1 · {family}",
    "dex_increment_no_family": "+1",
    "register_another": "Registrar otra",
    "share": "Compartir",
    "view_detail": "Ver detalle"
  }
}
```

Mirror EN. (Drafts EN inline en el commit.)

`/observe/classic` link migra desde el header inline en `ObserveView2.astro` (no está en `Header.astro` global) hacia `/profile/edit` bajo una nueva sección "Preferencias avanzadas" → "Usar formulario clásico de observación". String key `profile.advanced.use_classic_observe_form`.

Strings que se eliminan (cleanup):
- `observe.contextual_hint` ("PlantNet will identify plants and fungi…") — ya redundante con capability caption.
- `observe.edit_identification` ("Edit identification") — link eliminado.
- `observe.skip_identification_and_continue` — *no eliminada*; sigue usándose por el escape hatch de 15s.
- `observe.just_identify_dont_save` — eliminada (era el botón inline; el modo identify-only se mantiene vía ruta `?mode=identify`).
- `observe.skip_save` — eliminada.

---

## Algorithms registry — entry update

`src/lib/algorithms.ts` ya tiene `contextual_species_chips`. Hay que actualizar el `description` en EN y ES para reflejar el filtro nuevo (`establishment_means = 'wild'`). No se añade un algorithm-id nuevo; el surface es el mismo, solo cambian sus inputs.

```ts
{
  id: 'contextual_species_chips',
  description: {
    en: '… filters to wild observations only (excludes cultivated plants and captive/domestic animals)…',
    es: '… filtra a observaciones silvestres únicamente (excluye plantas cultivadas y animales domésticos/cautivos)…',
  },
  // resto sin cambios
}
```

Si "Probable here" se muestra también en estado 3 con context post-GPS (lo hace), no se necesita un algorithm-id distinto — el contexto cambió pero el algoritmo es el mismo.

El success state **no** es un surface ranked y por tanto **no requiere** WhyAmISeeingThis. La línea "Primera en este sector hoy" es factual (verificada server-side), no una estimación ranked. La línea de logro `+1 · {family}` es deterministic.

---

## Defaults memory — flujo de datos

```
Render del form (estado 1):
  1. Cliente llama getObservationDefaults(auth.uid())
  2. Lee users.last_observation_defaults (jsonb)
  3. Pre-rellena <select id="obs2-habitat">, <select id="obs2-weather">,
     <select id="obs2-license"> con esos valores (o blank si null)

Save de la obs (transición estado 3 → 4):
  1. Submit del form genera la INSERT a observations
  2. Después de COMMIT exitoso, llama setObservationDefaults({
       habitat: form.habitat || undefined,
       weather: form.weather || undefined,
       licenseCode: form.license || undefined,
     }) — solo persiste los campos que el usuario llenó
  3. UPDATE public.users SET last_observation_defaults = jsonb_strip_nulls(
       last_observation_defaults || $partial
     ) WHERE id = auth.uid();
```

`jsonb_strip_nulls` evita acumular nulls. El campo arranca `'{}'::jsonb` y crece con uso.

**Privacy:** este campo es leído solo por el propio usuario (RLS). Nunca se sirve a terceros. No es PII.

---

## Behaviors / state machine deltas

El state machine actual de `ObserveView2.astro` se preserva. Los deltas:

1. **Capability check temprana puede ocultarse en el banner:** mover el cómputo de `localAISupported() / hasPlantNetKey() / hasClaudeKey()` a un effect que renderiza el caption *después* de hidratación, no antes. Si el usuario tiene cero providers configurados, el caption dice "Configura un identificador…" con link.

2. **AI mode selector hide-when-disabled:** Si `availableModes.length === 1`, no renderizar el segmented control; renderizar caption "AI source: Sponsored" + link "Switch".

3. **Pipeline → stepper migration:** sustituir el render del `<svg id="pipeline-svg">` por `<PipelineStepper>` componente. El listener `rastrum:pipeline-update` se conserva — el stepper component lo escucha y mapea los `nodes[]` actuales a sus 3 stages:
   - `photo` = nodo de tipo `input`
   - `identify` = consolidación de nodos `identify` + `merge` (state derivado: si cualquiera failed → failed; si cualquiera running → active; si todos done → done)
   - `save` = nodo `save`
   - El nodo `location` se omite en el stepper visual pero su estado se incluye en el detail tooltip cuando el usuario tap'ea `save`.

4. **`obs2-contextual-chips` placement:** mover el bloque del HTML (hoy aparece arriba del DropZone en `ObserveView2.astro`) a justo después del `obs2-id-result` en el `obs2-post-form`. Render condicional: `gpsResolved && bestResult.confidence < 0.95` (cuando la AI ya respondió con alta confianza, los chips son ruido).

5. **Skip / Save consolidation:** eliminar IDs `obs2-skip-location`, `obs2-skip-save-btn`. El identify-only mode se sirve por la ruta `?mode=identify` (state machine ya soporta eso vía `mode === 'identify'`); el botón secundario de skip solo aparece cuando hay archivos pero no GPS o no ID.

6. **Success state mounting:** cuando el save resuelve, render `<ObservationSuccess>` reemplazando el div `obs2-success`. Las queries para `firstInSector` y `dexProgress` se hacen en paralelo (Promise.all) después del save commit, no bloquean el render del card básico.

---

## Tests

### Vitest

- `tests/observe/contextual-chips-filter.test.ts` — pglite — popla observations con mix de `wild`/`cultivated`/`captive`, llamar `suggest_nearby_species`, asertar que solo `wild` aparece.
- `tests/observe/observation-defaults.test.ts` — get/set roundtrip con jsonb_strip_nulls; merge parcial; arranque desde `'{}'::jsonb`.
- `tests/observe/success-claims-honest.test.ts` — `is_first_in_sector` returns false cuando `n < 50` aún si efectivamente es la primera del día. Returns true cuando `n >= 50` y es la primera.
- `tests/observe/pipeline-stepper-mapping.test.ts` — dado un array de `nodes[]` con states mixed, asertar que el stepper deriva el state correcto para `photo` / `identify` / `save`.
- `tests/observe/save-consolidation.test.ts` — render del form en distintos estados (no GPS, no ID, no AI runners) y asertar que solo aparecen los botones esperados (1 primario + máximo 1 secundario).

### Playwright

- `tests/e2e/observe-v2-empty-state.spec.ts` — abrir `/observe`, asertar que el dropzone es el bloque más alto en el viewport (selector `[data-testid="dropzone-hero"]` debe tener `getBoundingClientRect().top < 200`).
- `tests/e2e/observe-v2-celebration.spec.ts` — sign in, fixture obs save, asertar que el success state muestra "Tu observación #N", botón "Registrar otra" como primario, click re-monta el form en estado 1.
- `tests/e2e/observe-v2-defaults-memory.spec.ts` — fill form, save, abrir `/observe` de nuevo, asertar `<select id="obs2-habitat">` está pre-rellenado con el valor anterior.
- `tests/e2e/observe-v2-no-domestic.spec.ts` — fixture seed observations con `Canis familiaris` (`establishment_means = 'captive'`) cerca, abrir `/observe` con location simulada, asertar que el chip `Canis familiaris` no aparece.
- Mobile-chrome project: cubre los mismos flows.

### Manual verification

- `make db-apply` replay-safe (función `is_first_in_sector` y `CREATE OR REPLACE` de `suggest_nearby_species` son idempotentes; column add con `IF NOT EXISTS`).
- En staging: simular un usuario con cero providers → caption dice "Configura un identificador…", no banner intimidante.
- En staging: medir LCP del `/observe` antes y después del rediseño — el dropzone arriba debería bajar el LCP.
- Visual regression test (Playwright snapshot) sobre el success state.

---

## Rollout — PR slicing

Siete PRs incrementales, cada uno independientemente shippable y revertible. Orden elegido para sacar primero los cambios sin riesgo y dejar el rediseño visual al final.

| PR | Alcance | Risk | Reverso |
|---|---|---|---|
| **PR 1** | Schema delta: `users.last_observation_defaults` + `users.observation_count` (si no existe) + `is_first_in_sector()` función | Bajo — solo añade columnas + función SECURITY DEFINER | Drop column / drop function |
| **PR 2** | `suggest_nearby_species` filtro `establishment_means = 'wild'` + `photo_url` NULL | Bajo — `CREATE OR REPLACE` idempotente | Restore previous body |
| **PR 3** | `src/lib/observation-defaults.ts` + integration en form load (pre-fill habitat/weather/license) | Bajo — cero UI nueva | Stop calling `getObservationDefaults` |
| **PR 4** | `PipelineStepper.astro` nuevo + feature flag `PUBLIC_OBSERVE_PIPELINE_GRAPH` (default off) | Medio — cambio visual del pipeline | Flip flag a `1` |
| **PR 5** | Reorder de bloques en `ObserveView2.astro` + capability caption + AI mode hide-when-disabled + chip move post-GPS + classic-form link a settings | Alto — el cambio visual más grande | Revertir el commit |
| **PR 6** | `ObservationSuccess.astro` nuevo + reemplazo del `obs2-success` + queries paralelas para firstInSector/dexProgress | Medio — cambia el end-state pero no el data path | Revertir; `obs2-success` original sigue en git history |
| **PR 7** | Save / skip consolidation: eliminar 3 botones secundarios; el identify-only se sirve solo por ruta. Active observers banner mueve al pie. | Medio — toca state machine | Revertir |

Cada PR incluye sus tests Vitest y Playwright relevantes, no agregados al final. CI:

- `.github/workflows/db-validate.yml` cubre PR 1 + PR 2 (idempotencia schema).
- `.github/workflows/e2e.yml` cubre PR 4–7.

---

## Métricas de éxito

Cuantificables, medibles en staging antes de producción:

1. **LCP de `/observe`** baja al menos 200ms (medido con Lighthouse CI antes/después). Hipótesis: el dropzone arriba mejora el Largest Contentful Paint porque el SVG dropzone es el LCP candidate.
2. **Tasa de saves con habitat/weather/license llenos** sube ≥ 20% (medido con un evento de PostHog `obs_form_advanced_filled`). Hipótesis: defaults pre-llenos eliminan el costo de re-llenarlos cada vez.
3. **Tasa de "Registrar otra" tras un save** > 0% (hoy es N/A porque el botón no existe). Hipótesis: convertir el success en trigger del siguiente crea bursts de observaciones consecutivas (Tiny Habits).
4. **Tasa de "Save without identification"** se mantiene estable o sube. Hipótesis: con dos botones claros en lugar de cinco salidas, el path "save anyway" se hace más visible.
5. **Drop en clicks a "Set up →" del capability banner** (hoy un CTA dedicado). Hipótesis: con caption discreto, los clicks bajan — esperado y deseado, porque el CTA hoy es un nag.

---

## Open questions for the implementation plan

(Estas no se deciden aquí — son para el paso de planning.)

- ¿El feature flag `PUBLIC_OBSERVE_PIPELINE_GRAPH` se quita en v1.1 o se queda como permanent escape? Recomiendo quitarlo después de 30 días sin reportes; agregarlo a la lista de "future cleanup" en `progress.json`.
- ¿La query `is_first_in_sector` en el success state es bloqueante o se renderiza progresivamente? Si toma > 200ms en staging, hacerlo lazy con un placeholder ("verificando…") y reemplazar al resolver. Final call después de medir.
- ¿`ObservationSuccess` debe persistir el "celebration" más allá del próximo Drop? Si el usuario inicia otra observación (estado 1) sin completarla y vuelve, ¿debería el success state seguir visible? Recomiendo: no — el success se desmonta al primer file drop o navegación. Confirmar.
- ¿Mostrar el `dexProgress` para todos los usuarios o solo aquellos que tienen ≥ N observaciones (para evitar mostrar "1/100" en el primer save y deprimir)? Recomiendo: mostrar siempre, pero con copy ajustado para `count == 1` ("¡Tu primera!"). Prototipar.
- ¿La extracción de subcomponentes desde `ObserveView2.astro` (1171 LOC) se programa como v1.1 follow-up issue o se deja como tech-debt informal? Recomiendo issue explícito.
- ¿`users.observation_count` ya existe como columna popularizada por algún trigger / cron de community-discovery (módulo 28)? Si sí, skip el `ADD COLUMN IF NOT EXISTS`. Si no, decidir si lo poblamos con un trigger BEFORE INSERT en `observations` o leemos el count en tiempo real cada save. Verificar en planning con `\d+ public.users` y `grep observation_count supabase-schema.sql`.
