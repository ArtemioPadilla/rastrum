# Auditoría integral de sitio y codebase — 2026-06-09

> Auditoría realizada con exploración en vivo de https://rastrum.org (Chrome,
> sesión anónima, tema dark y light) + revisión profunda del codebase en seis
> frentes paralelos (src/lib, componentes/layouts, páginas/i18n, backend
> Supabase, CLI/tests/CI, PWA shell). Cada hallazgo de código fue verificado
> contra el fuente antes de incluirse. Severidades: **P0** (roto en producción
> o fuga de datos), **P1** (alto), **P2** (medio), **P3** (bajo / pulido).

---

## Resumen ejecutivo

El producto está en buena forma estructural: la disciplina de idempotencia
SQL, el firewall de consenso R1–R3, la paridad EN/ES de los JSON (3503/3503
claves), el safelist de Tailwind y la política TZ-determinista de tests están
intactos. Pero la auditoría encontró **cuatro problemas P0** que merecen
atención inmediata: (1) todas las fotos de `/explore/recent/` llevan ~2
semanas rotas en producción por variantes `cdn-cgi/image` que devuelven 503;
(2) las coordenadas precisas de especies sensibles son legibles por `anon`
vía PostgREST pese al mecanismo de coarsening; (3) el formulario nuevo de
Observe ignora la ubicación elegida en el mapa y sincroniza observaciones en
isla-nula (0,0) como registros reales; (4) la API REST referencia una columna
inexistente (`id_source`) que rompe `GET /api/observations`, `GET /api/export`
y descarta silenciosamente las identificaciones enviadas por API. Además hay
tres agujeros de integridad en CI que reproducen exactamente la clase de
incidente del PR #42 / #1015.

### Top 10 acciones recomendadas (en orden)

| # | Acción | Ref |
|---|---|---|
| 1 | ✅ hecho 2026-06-11 (transformations habilitado) — falta fallback `onerror` + recorte de matriz por el quota de 5k/mes | §1.1 |
| 2 | `REVOKE SELECT (location)` a anon/authenticated en `observations` + test RLS de columna | §2.1-C1 |
| 3 | Listener `rastrum:mappicker-save` en ObserveView2 + `asDraft` sin coords | §2.2-C1 |
| 4 | Corregir `id_source` → `source` en la EF `api` (4 sitios) | §2.1-C3 |
| 5 | Ownership-check + cap de confianza en `upsert_primary_identification` | §2.1-H1 |
| 6 | Borrar `db-validate-noop.yml` (puede satisfacer el check requerido `validate` en verde instantáneo) | §2.4-H1 |
| 7 | `fetch-depth: 0` + fallo ruidoso en `deploy-functions.yml` (patrón PR #42) | §2.4-H2 |
| 8 | Escapar `display_name`/`avatar_url` en PlaceDetailView/WatchlistView (XSS almacenado) | §2.1-H2 |
| 9 | Quitar `lat/lng` del querystring en HomeNearby (regla M28) | §2.1-H3 |
| 10 | Quitar el tier `PUBLIC_ANTHROPIC_KEY` del bundle cliente | §2.1-H4 |

---

# Parte 1 — Sitio web en producción (UX / UI / diseño)

## 1.1 P0 — Todas las fotos de observaciones aparecen rotas en `/explore/recent/`

**Síntoma observado.** Cada tarjeta de `/en/explore/recent/` muestra el icono
de imagen rota + texto alt (*Peromyscus felipensis*, *Nyctocereus serpentinus*,
*Xysticus*, *Diogmites*, *Stapelia gigantea*…). Ocurre en dark y light, en
cada navegación. La superficie principal de descubrimiento se ve abandonada.

**Diagnóstico (verificado en vivo).**
- Los `<picture>` generados por `src/lib/image-variants.ts` (PR #1206,
  2026-05-25, PBI 2.1) emiten `<source>` AVIF/WebP vía Cloudflare Image
  Resizing: `https://media.rastrum.org/cdn-cgi/image/width=…,format=avif,…/observations/….jpg`.
- **Toda URL `/cdn-cgi/image/...` devuelve HTTP 503 en producción** (capturado
  en el panel de red: 10+ requests 503). La URL cruda
  `https://media.rastrum.org/observations/….jpg` devuelve 200 `image/jpeg`.
- El navegador selecciona el `<source>` AVIF, recibe 503, y **no hace fallback
  al `src` crudo** — un fallo de red del candidato elegido no reactiva el
  fallback de `<picture>`. Resultado: imagen rota.
- Confirmación cruzada: en `/share/obs/?id=…` la foto hero (URL cruda) carga
  perfectamente; las miniaturas variantes no.

**Causa raíz.** Cloudflare *Image Transformations* no está habilitado (o dejó
de estarlo) para la zona que sirve `media.rastrum.org`. El comentario del
módulo (`image-variants.ts:7-9`) asume que el host "is fronted by Cloudflare's
image-resizing endpoint", supuesto que producción no cumple hoy. Las fotos de
explore llevan ~2 semanas rotas (desde el merge de #1206).

**Fix recomendado (dos capas).**
1. *Operador:* habilitar Image Transformations para la zona en el dashboard de
   Cloudflare y verificar
   `curl -I 'https://media.rastrum.org/cdn-cgi/image/width=320,format=webp/observations/<id>/<id>.jpg'` → 200.
2. *Código (defensa):* a) `onerror` en el `<img>` del `<picture>` que elimine
   los `<source>` y deje el `src` crudo; b) añadir un probe del endpoint
   `cdn-cgi/image` a `infra/smoke-model-assets.sh` para que el smoke nocturno
   detecte la regresión (hoy solo se prueban los assets de modelos).

**Resolución (2026-06-11).** El operador habilitó Image Transformations →
las fotos de explore volvieron. Restricción nueva: el plan incluye **5,000
transformaciones únicas/mes** (combinación imagen+opciones; los hits de caché
no cuentan). La matriz actual es 3 anchos × 2 formatos = 6 variantes/foto →
~830 fotos distintas/mes. Hoy (~70 fotos) se usa ~8%, pero **al agotarse el
quota a mitad de mes las variantes nuevas vuelven a fallar — y sin fallback
en el `<picture>` es el mismo P0, ahora intermitente**. Plan acordado en dos
tiempos:
- *Corto plazo:* fallback `onerror` (quota agotado ⇒ degrada al JPEG crudo,
  invisible para el usuario) + recortar la matriz a 2 anchos × 1 formato
  (AVIF) ⇒ ~2,500 fotos/mes de margen.
- *Mediano plazo (zero-cost):* generar el thumbnail en el cliente al subir —
  `upload.ts` ya redimensiona a 1200 px; añadir un segundo resize ~480 px
  WebP y subir ambos a R2. Las tarjetas usan la URL cruda del thumb: cero
  transformaciones, sin quota, y la feature de Cloudflare se vuelve
  prescindible. Costo: ~2× objetos en R2 (almacenamiento barato, sin egreso).

## 1.2 P1 — Mapa de observaciones sin marcadores y sin estado vacío

`/en/explore/map/` carga los tiles (estilo dark, vista Oaxaca) pero no se ve
ni un marcador/cluster pese a que el catálogo reporta 44 observaciones. No hay
estado vacío ("no hay observaciones en esta vista"), ni auto-fit a los datos.
Para un visitante nuevo el mapa parece roto. Recomendado: `fitBounds` al bbox
de resultados al cargar + empty-state explícito. Nota relacionada:
`ExploreMap.astro:301` filtra puntos `lat===0 && lng===0`, así que las
observaciones isla-nula del bug §2.2-C1 desaparecen del mapa silenciosamente.

## 1.3 P1 — Pill de confianza "0%" en rojo en todas las tarjetas

En `/explore/recent/`, cada tarjeta muestra `0%` en pill rojo + `♡ 0`
(`ExploreRecentView.astro:358-359`). Para observaciones con confianza 0,
"0%" en rojo castiga visualmente el contenido sin informar. Recomendado:
ocultar el pill cuando `confidence === 0` y sustituirlo por una etiqueta
"Needs ID" que invite a validar.

## 1.4 P2 — `/{lang}/identify/` redirige a Observe sin identidad propia

`src/pages/en/identify.astro` es un 301 a `/en/observe/?mode=identify`
(issue #273). En la página resultante la pestaña activa es **Observe**, el
título es "Log observation" y el aviso de modo es one-shot
(`rastrum_identify_mode_notice_v1`). Quien llega desde "Identify" (footer,
hero) no percibe diferencia alguna. Recomendado: con `?mode=identify` cambiar
el `<h1>` y el copy del dropzone. Además, la clave localStorage
`rastrum_identify_mode_notice_v1` viola la convención de `onboarding-state.ts`
("do NOT mint a new top-level rastrum.* key") — migrarla al documento
`rastrum.user.onboardingState`.

## 1.5 P2 — Breadcrumb duplicado en todas las páginas de docs

En `/en/docs/roadmap/` se renderizan dos breadcrumbs apilados: "Docs ›
Roadmap" (global, `BaseLayout.astro:390` → `Breadcrumbs.astro`) y "Docs /
Roadmap" (hand-rolled en `DocLayout.astro:40-48`). Eliminar el inline de
`DocLayout` (el global ya emite StructuredData + nav).

## 1.6 P2 — Copy inconsistente en Sign-in: "magic link" vs "Send code"

`/en/sign-in/`: el subtítulo promete "We'll email you a magic link" pero el
botón dice "Send code" (`auth.sign_in_subtitle` vs `auth.send_code`,
`en.json:442,457`). El flujo real envía código + link. Alinear el copy.

## 1.7 P2 — Home sin prueba social ni datos vivos

La home es hero + "How It Works" + "Why Rastrum" + footer; no muestra nada
del contenido real (los stats ya existen en `/explore/species/`: 12 especies,
44 observaciones, 5 observadores). Sugerencia: franja de stats + 4 tarjetas
de observaciones recientes (cuando §1.1 esté arreglado) entre el hero y
"How It Works".

## 1.8 P3 — Detalles menores observados en vivo

| # | Hallazgo | Detalle |
|---|---|---|
| 1 | Emoji de clima sobre el hero (🌧) sin tooltip | Darle `title`/aria-label ("Current weather in Oaxaca") para que parezca intencional. |
| 2 | "Docs" sin traducir en el header ES | El resto del chrome está localizado (Observar/Explorar/Acerca). |
| 3 | Tarjetas de observador sin avatar muestran círculo vacío | Fallback a iniciales del handle. |
| 4 | "last seen —" repetido en cada tarjeta de observador | Omitir la fila cuando no hay dato. |
| 5 | Guía "Step 1 of 3" se muestra a anónimos en community en el primer paint | Lanzarla tras la primera interacción. |
| 6 | Fecha duplicada en `/share/obs/` | Bajo el título y otra vez en "Date". |
| 7 | Pill "EN" activo casi invisible en tema claro | Contraste bajo del estado activo del switcher. |
| 8 | Roadmap doc abre con "wall of text" en itálicas | Colapsar el changelog en `<details>`. |
| 9 | "Skip guide" con contraste bajo en dark | Guía de community. |

**Positivo destacable**: la 404 ("Species not found in this habitat") es
excelente; el chooser de modelos del Chat es la mejor explicación on-device
vista en una PWA; sign-in con passkey + OAuth + OTP completo; el empty-state
del dropzone de Observe es claro.

*(Prueba móvil visual no realizada: el window manager impidió reducir el
viewport; la cobertura mobile queda en el proyecto `mobile-chrome` de
Playwright.)*

---

# Parte 2 — Codebase

## 2.1 Seguridad y privacidad

### C1 (P0) — Coordenadas precisas de especies sensibles legibles por `anon`
`supabase-schema.sql:460-468` (policy `obs_public_read`) + `:582` (GRANT a
anon). La policy admite filas sensibles cuando `location_obscured IS NOT
NULL`, y la columna `location` (precisa) viaja con la fila: un cliente anónimo
puede hacer `GET /rest/v1/observations?select=id,location&obscure_level=eq.5km`
y obtener coordenadas exactas. RLS filtra filas, no columnas, y no existe
ningún `REVOKE SELECT (location)`. Las vistas usan `COALESCE(location_obscured,
location)` correctamente, pero la tabla base es consultable directo.
**Fix:** `REVOKE SELECT (location) ON public.observations FROM anon,
authenticated;` y forzar lecturas públicas vía vistas/RPCs; añadir test en
`tests/sql/rls.sql` que seleccione `location` como anon sobre una fila `5km`.

### C2 (P0) — `upsert_primary_identification` permite secuestrar la ID primaria de cualquier observación
`supabase-schema.sql:8085-8133`. SECURITY DEFINER, grant a `authenticated`,
sin verificación de ownership, sin validación de `p_source` ni cap de
confianza. Cualquier usuario autenticado puede llamarla con
`p_confidence=1.0, p_source='human'` contra cualquier `observation_id` —
degrada la primaria existente, instala la suya y propaga a
`observations.primary_taxon_id`. Viola el firewall R1 (solo aplicado en
`sync.ts`, lado cliente). **Fix:** check de `observer_id = auth.uid()` +
validar/capar `p_source`/`p_confidence` dentro de la función.

### C3 (P0) — La EF `api` referencia la columna inexistente `id_source`
`supabase/functions/api/index.ts:133,239,263,296`. La columna real es
`source` (`schema:330`). `POST /api/observe` inserta `{id_source:…}` e ignora
el error → las identificaciones por API se pierden en silencio; `GET
/api/observations` y `GET /api/export` devuelven 500 (PostgREST rechaza la
columna). El `mcp` hermano usa `source` correctamente. **Fix:** renombrar en
los 4 sitios + chequear el error del insert.

### H1 (P1) — XSS almacenado en renderers de listas
`PlaceDetailView.astro:270-312` inyecta `${u.display_name}` y
`${u.avatar_url}` en `innerHTML` sin escapar (el archivo no importa ningún
escaper); `WatchlistView.astro:177` interpola `avatar` sin escapar. Un
display name `<img src=x onerror=…>` ejecuta para cada visitante. Los
hermanos (CommunityView, InboxView, HomeNearby, Comments) escapan bien — es
drift por archivo. **Fix:** usar `src/lib/escape.ts` + test que grepee
`innerHTML` en archivos que no lo importen.

### H2 (P1) — GPS preciso en querystring (viola la regla M28 propia)
`home/HomeNearby.astro:212` construye `?lat=…&lng=…&radius=…` con el fix GPS
exacto — el patrón que la regla M28 prohíbe (fuga vía Referer e historial).
Doblemente roto: `ExploreMapView.astro:180-210` ni siquiera lee esos params.
**Fix:** quitar los params o pasar por `sessionStorage`
(`rastrum.community.gps`); extender `community-url.test.ts` a esta superficie.

### H3 (P1) — `PUBLIC_ANTHROPIC_KEY` embebe una key de operador en el bundle público
`src/lib/anthropic-key.ts:35` (+ `identify-runners.ts:219`). Cualquier
`PUBLIC_*` se inserta en el JS del cliente: si el operador la setea, su key de
Anthropic queda publicada a todos los visitantes — el mismo anti-patrón
eliminado para PlantNet en #1037. **Fix:** eliminar el tier y enrutar el gasto
de operador por la resolución de sponsorship/pool del EF `identify`.

### M (P2) — Otros hallazgos de seguridad backend
- **`get-upload-url`** (`index.ts:33-46`): prefijo `observations/` sin scope de
  usuario — cualquier autenticado puede presignar PUTs en el prefijo de otra
  persona. El twin en `api/index.ts:213` sí scopea `observations/${user_id}/`.
- **`enrich-environment`** (`index.ts:52-117`): sin JWT ni cron-secret;
  cualquier anónimo puede sobrescribir clima/luna de cualquier observación
  (write con service-role) y amplificar llamadas a OpenMeteo.
- **`profile_pokedex`** (`schema:3045`): filtra `obscure_level <> 'private'`,
  valor que el enum no contiene (no-op). Debe ser `<> 'full'` como sus vistas
  hermanas — hoy expone la *posesión* de especies totalmente protegidas.
- **`stripe-webhook`**: HMAC sin chequeo de frescura del timestamp (replay).
- **`sync-error`**: el throttle por IP prometido en el docstring no existe.
- **`infra/check-no-secret-logs.sh:16`**: solo inspecciona `console.log`;
  ampliar a `console.warn/error`.
- **Rate-limit en memoria por isolate** en `get-upload-url` (mismo problema
  que #581 arregló en `identify` con `anon_rate_limit`).
- **CLI** (`api-client.ts:106`): los errores de PUT persisten la URL presignada
  completa (con `X-Amz-Signature`) en `import-log.json` en la SD card —
  loguear solo origin+pathname.

## 2.2 Bugs funcionales

### C1 (P0) — ObserveView2 ignora la ubicación del MapPicker y sincroniza observaciones (0,0)
`ObserveView2.astro:1318-1321` + `MapPicker.astro:360-365`. El save handler
solo usa la variable `location` que setea `startGPS()`; **no existe listener
para `rastrum:mappicker-save`** (solo ObservationForm y manage-panel lo
escuchan), pese a que el comentario promete "Users without GPS can still pick
a location via the map". Con GPS denegado, el submit cae a
`{lat: 0, lng: 0}` sin `asDraft` → un registro real en isla nula, que además
`ExploreMap` filtra (desaparece del mapa). Compuesto: el fix de GPS se
despacha con el evento equivocado (`rastrum:mappicker-set` solo aplica a
pickers `mode="view"`; el de obs2 es `edit` y necesita
`rastrum:mappicker-set-initial`), así que el modal abre en la vista por
defecto de México y no en el fix del usuario. **Fix:** listener filtrado a
`id === 'obs2-map'` que actualice `location`; `asDraft: !location` (como
QuickObserveSheet); despachar `set-initial`. Añadir aserción e2e en
`observe-card.spec.ts` — esta clase de bug es exactamente la lección
"client `<script>` is e2e-gated".

### H (P1) — Bugs altos
- **CommandPalette** (`CommandPalette.astro:242-276,344-349`): Enter ejecuta
  `currentResults[activeIdx]` en orden de relevancia mientras las filas se
  pintan reagrupadas por tipo → el teclado abre un resultado distinto al
  resaltado. Fix: reconstruir `currentResults` en el orden agrupado.
- **SwUpdateToast** (`SwUpdateToast.astro:62-91`): auto-aplica el SW update y
  recarga la página a los 10 s sin importar si hay un formulario a medias —
  puede tirar fotos staged y notas. Fix: nunca auto-recargar, o solo con
  `document.hidden` y sin formularios sucios.
- **Autocomplete de taxones** (`taxon-autocomplete.ts:52-92`): el boolean
  `cancelled` compartido se resetea en cada llamada → resultados stale pueden
  pisar a los nuevos. Fix: request-id monotónico o AbortController.

### M (P2) — Bugs medios
- **ConsentBanner → PostHog** (`ConsentBanner.astro:16-17,128`): nadie escucha
  `rastrum:consent-updated`; analytics solo arranca en la siguiente
  navegación completa.
- **JWT pineado en init en 7 vistas de consola** (`ConsoleErrorsView.astro:547`
  y hermanas): tras ~1 h el token expira y acknowledge/replay/approve
  empiezan a dar 401 hasta recargar. Fix: resolver token por llamada vía
  `getCachedSession()`.
- **Footer**: "Install app" (`Footer.astro:87`) no tiene handler — UI muerta;
  Mastodon/RSS apuntan a `href="#"` (`:74-75,147-148`).
- **`daily-challenge.ts:14,22`**: caché no keyed por userId — cambio de cuenta
  sin reload devuelve el challenge del usuario anterior.
- **`local-ai.ts:475` / `onnx-vision.ts:207`**: `lat === 0` se trata como
  falsy y se descarta el hint de ubicación — el ecuador cruza la región
  objetivo. Usar `Number.isFinite`.
- **`dwca.ts:308-316`**: papaparse cita campos con tab/newline pero `meta.xml`
  declara `fieldsEnclosedBy=""` — un display name con tab corrompe el archive.
- **`confidence-ceiling.ts:11,13`**: las claves `speciesnet` y `phi_vision` no
  matchean los ids reales (`speciesnet_distilled`, `webllm_phi35_vision`) →
  el "single source of truth" del firewall R2 no dispara para esas fuentes
  (hoy lo salvan self-caps redundantes). Corregir claves + test de que todo
  plugin registrado resuelve un ceiling.
- **`QuickObserveSheet.astro`** (369 líneas): dead code sin imports, con
  trampa latente de IDs duplicados de DropZone si algún día se monta.

## 2.3 Rutas, i18n y SEO

- **H (P1) — `/es/perfil/listas/` no existe**: `ProfileSpeciesListsLink.astro:22`
  hardcodea el href; todo usuario ES que pulse "Mis listas" recibe 404. Crear
  la página espejo + entrada en `routes`.
- **H (P1) — hreflang y language-switcher rotos en ~9 pares de slug asimétrico**
  sin entrada en `routes{}` (`projects/detail`↔`proyectos/detail`,
  `profile/u/followers`↔`perfil/u/seguidores`, `following`, `u/lists`,
  `wrapped`, `observations/local`, `observe/classic`, `places/compare`,
  `docs/surprises`). Verificado en `dist/`: los hreflang emiten URLs 404.
- **H (P1) — drift fuerte de páginas ES**: `/es/explorar/lugares/comparar/`
  (106 líneas vs 231 EN, sin autocomplete ni dark/light) y
  `/es/docs/index.astro` (solo 12 de 23 doc pages listadas, estilos dark-only,
  copy hardcodeado). Causa raíz: no delegan a un View compartido — extraer
  `PlacesCompareView` / `DocsIndexView`.
- **M (P2)**: `scripts/sitemap-hreflang.js` duplica a mano el mapa de rutas y
  quedó ~20 rutas atrás (importar de un módulo compartido); typo OG
  `'/perfil/patrocinando'` vs ruta real `patrocinios`
  (`BaseLayout.astro:98`); 39 URLs de consola noindex dentro del sitemap
  público (extender el filter de `astro.config.mjs`); páginas muertas
  `en/profile/edit.astro` + `es/perfil/editar.astro` sombreadas por redirects;
  wrapped/tokens duplicados inline por idioma (extraer Views); banner "Current
  phase: v0.1 Alpha" desactualizado en ambos docs index.
- **L (P3)**: `routes.community` apunta a páginas inexistentes;
  meta-description default en inglés para páginas ES sin prop;
  `routes.profileFollowers/Following` apuntan al padre.
- **Limpio**: paridad JSON 3503/3503; cero regresiones de la clase
  `/share/obs/` locale-prefix; 120/120 páginas EN/ES pareadas.

## 2.4 Integridad de CI y tests

### H1 (P1) — `db-validate-noop.yml` puede satisfacer el check requerido `validate`
Desde #1015 el `db-validate.yml` real corre en **todo** PR, pero el noop sigue
vivo y reporta un check del mismo nombre `validate` en verde a los ~6 s
(verificado en runs 26613941016/26605528650 + branch-protection API). Si el
real falla, el duplicado instantáneo puede satisfacer el contexto requerido —
exactamente el modo de fallo silencioso del incidente #1015. **Borrar el
workflow.**

### H2 (P1) — `deploy-functions.yml` repite el patrón de diff enmascarado del PR #42
`deploy-functions.yml:71` (`fetch-depth: 2`) + `:109-129`
(`git diff … || true`). Un push multi-commit deja a `github.event.before`
fuera del clone → diff falla → `|| true` lo enmascara → "no function-code
changes detected" **en verde sin desplegar nada**. `db-apply.yml` ya fue
endurecido contra esto; espejar: `fetch-depth: 0`, sin `|| true`, fallo
ruidoso si el base no resuelve.

### H3 (P1) — `smoke-nightly.yml` falla todas las noches con "No tests found"
Apunta a `tests/smoke/` pero `playwright.config.ts` fija
`testDir: 'tests/e2e'` → 0 tests, exit 1, cada noche (verificado 06-05 →
06-09). Es casi duplicado de `nightly-smoke.yml` (que sí pasa). Consolidar en
un solo smoke nocturno y borrar el otro + `tests/smoke/home.spec.ts`.

### M (P2) — Cobertura ilusoria y huecos
- **`pwa.spec.ts:30-37`**: `test.skip(true, …)` a nivel de describe salta el
  grupo completo — manifest y theme-color llevan sin cobertura desde entonces.
- **Tests del SW espejan código copiado a mano**, no `public/sw.js` (los 3
  suites `sw-pmtiles-*`); una regresión en el artefacto real no falla nada.
  Extraer el algoritmo a un módulo compartido o añadir aserción estructural
  sobre el archivo.
- **Proyectos Playwright solapados**: los 90 journeys corren bajo `chromium`
  a 30 s; los proyectos `journey-*` (60 s) no corren nunca en CI. Añadir
  `testIgnore` + wiring.
- **`check-rls-coverage.sh:48-82`** (encontrado por dos agentes
  independientes): el parser awk pierde `CREATE POLICY` multilínea — la
  policy `"probable_taxa_cache: anon can read"` (`schema:11941`) escapa hoy
  del gate (ni test ni allowlist) y cualquier futura policy multilínea
  también. Acumular líneas hasta ver `ON <schema>.<table>` + self-test de
  conteo. Además los nombres con espacios/dos puntos jamás matchean la
  gramática del marker.
- **Cero tests de comportamiento** para `sync.ts` (¡el motor del outbox con
  el invariante R2!), `auth.ts`, `db.ts`, `upload.ts`. El único guard de
  sync es un grep de strings sobre el fuente. Son los targets de mayor valor
  del repo dada la historia de bugs de sync (#353).
- 3 tests owner-flow gated por `E2E_OWNER_SESSION` que no se setea en ningún
  lado (nunca han corrido).
- 11 workflows sin bloque `permissions:`; `ci.yml:89` usa `npm install` en
  vez de `npm ci` para el CLI; lista `CRON_ONLY` hand-maintained en
  deploy-functions (un cron EF nuevo que falte se despliega con verify-jwt →
  el 401 silencioso documentado).

## 2.5 CLI (batch import)

- **M — pérdida de log y duplicados**: un `readdir` EACCES (común en SD de
  cámaras trampa) aborta el run sin `saveLog` final (`cli.ts:166-178`) — hasta
  9 entradas subidas se pierden del log y el re-run **duplica observaciones**.
  Envolver en try/finally + tolerar errores por directorio en el walker.
- **M — ventana de duplicado en observe→log**: la entrada se registra después
  del identify opcional (`cli.ts:111-151`) y ningún fetch tiene timeout — un
  Ctrl-C con identify colgado duplica la observación al re-run. Registrar
  `uploaded` inmediatamente tras `observe()` + `AbortSignal.timeout`.
- **M — log no atómico**: `writeFile` directo (`log.ts:52-55`) + `loadLog`
  que hard-throw en JSON corrupto = import irreanudable tras un crash.
  Escribir `.tmp` + `rename`; apartar el corrupto y seguir.
- **L**: fecha EXIF en formato crudo `YYYY:MM:DD` → Invalid Date silencioso;
  exit code envenenado por fallos históricos del log; `parseArgs` traga el
  siguiente token tras un flag booleano (`--dry-run ./photos` →
  `dryRun=false`).

## 2.6 Accesibilidad e i18n de componentes

- **~17 archivos usan `bg-emerald-600 + text-white`** (3.76:1) contra la regla
  documentada de ≥`emerald-700` — lista completa en el reporte del agente:
  QuickObserveCapture, TrailsView, PITsView, ConsoleBadges/Bioblitz/
  ExpertValidation, PoolDonateView, MobileBottomBar (FAB), ObservationForm,
  HomeWidgets, PitLandingView, CommunityThemeSubmitModal, KarmaLeaderboardView,
  ExploreMapView, BellIcon, SpeciesCard, PrivacyMatrix. Dos de ellos togglean
  vía `classList`/constantes (cuidado con la trampa multi-token). Añadir la
  cuarta regla al `color-contrast-policy.test.ts` para ratchet.
- **aria-labels en inglés hardcodeado en superficies bilingües**: Header
  ("Account menu", "Toggle dark mode"), Breadcrumbs, Footer ("Language"),
  OnboardingTour, SettingsShell, MicroSurvey, ExploreRecentView ("Favorite",
  "No photo"), ObservationForm, HomeChips… mover a claves i18n.
- **Cientos de strings inline `isEs ? … : …`** en vez de `src/i18n/*.json`:
  ObserveView2 (72), ExpeditionMode (33), BatchImporter (26), ChatView (21),
  MapPicker (18)… y los hints del footer del CommandPalette son EN-only.
  Migración incremental; mínimo los hints del palette.
- **Gaps de teclado/ARIA**: dropdown de avatar sin aria-expanded/Escape/focus;
  MegaMenu `role="menu"` sin navegación por flechas; MobileDrawer
  `aria-modal` sin focus trap (ConsoleLayout lo hace bien — copiar patrón);
  CommandPalette con `role="combobox"` en el div en vez del input; lightbox
  de PhotoGallery sin focus trap.
- **Menores**: `console.log` en ExplorePlacesView:140,324 y
  `manage-panel.ts:792` (este último loguea coordenadas del usuario);
  self-XSS del email en SignInForm:171; zinc-500 vía CSS crudo en
  TaxonAutocomplete:74 (invisible para el test de política); footer body copy
  en zinc-400; `loading="lazy"` faltante en imágenes inyectadas por JS
  (PlaceDetailView, WatchlistView, Comments); typo de casing
  `ArtemIOPadilla` en DocLayout:22,75; nombres comunes EN para usuarios ES en
  ObserveView2/QuickObserveSheet; presupuesto de esquina: 3 FABs flotantes
  coexisten abajo-derecha en modo standalone.

## 2.7 Calidad / deduplicación

- `escapeHtml` cuadruplicado (`escape.ts`, `social.ts`, `chat-bubble-html.ts`,
  `identifier-card-html.ts`) — re-exportar del central.
- Verificación de tokens `rst_*` duplicada en `api` y `mcp` (la divergencia es
  justo donde vivía el bug `id_source`); export Darwin Core triplicado
  (api/mcp/export-dwca — y las copias inline emiten lat/lng precisos sin
  manejo de obscure_level, auditable si los scopes crecen); CORS + `json()`
  re-declarados por función → `_shared/`.
- Hash-buster `__rastrumRedeploy` copy-pasteado en ~20 EFs (borrar en un sweep
  cuando se resuelva el ticket de Supabase); `callOnnxBase` dead-code en cada
  cascada; codemods huérfanos `scripts/fix_imports.py`,
  `scripts/migrate_cached_user.py`; import sin uso en ConsoleLayout:368;
  `@types/papaparse` en dependencies.
- El tema Field solo existe en BaseLayout — en páginas de consola resuelve a
  dark plano (confirmar si es intencional).

---

# Parte 3 — Propuestas de producto y funcionalidades

1. **Home viva** (§1.7): stats reales + carrusel de observaciones recientes +
   mini-mapa. Es la palanca de conversión más barata del sitio.
2. **Observación sin media**: hoy no hay camino para registrar un avistamiento
   sin foto/audio (los chips de taxón solos no abren el formulario). iNaturalist
   lo permite; valioso en campo con batería baja o especies huidizas.
3. **"Needs ID" como invitación**: convertir el pill 0% (§1.3) en CTA hacia
   `/explore/validate/` — el loop de validación comunitaria gana tráfico.
4. **fitBounds + heatmap en el mapa** (§1.2): con 44 observaciones el cluster
   layer apenas se ve; un heatmap de baja densidad comunica "hay vida aquí"
   incluso con pocos datos.
5. **Fallback de avatar con iniciales** y ocultar "last seen —" vacío en
   community (§1.8).
6. **Onboarding del modo identify**: h1 + copy dinámicos bajo
   `?mode=identify` (§1.4).
7. **Smoke de assets ampliado**: añadir `cdn-cgi/image` y una URL de foto de
   observación real al `infra/smoke-model-assets.sh` — las dos roturas de
   media de esta auditoría (503 de variantes; y la histórica del dominio
   `.app`) habrían sido detectadas la primera noche.
8. **Ratchets nuevos**: regla emerald-600+white en el contrast test; grep de
   `innerHTML` sin `escape.ts`; self-test de conteo en check-rls-coverage;
   aserción estructural sobre `public/sw.js`.

---

# Parte 4 — Cobertura de user journeys

Triangulación de tres fuentes: (a) exploración anónima en vivo de producción
(esta auditoría), (b) la suite `journey-*` de Playwright corrida localmente
contra el build (`--project=journey-chromium --project=journey-mobile`:
**90/90 passed, 15.6 s**, 2026-06-09), y (c) el catálogo formal
`docs/journey-catalog.md` (§2, última verificación manual 2026-05-16/17).

**Límite honesto de la suite e2e:** los specs de journey son mayoritariamente
checks de render + navegación contra el build estático (modelo de chat
mockeado, sin sesión real de Supabase). Validan que el shell no se rompe; NO
ejercitan escrituras reales ni dependencias de infraestructura de producción.
Prueba de ello: **ninguno de los 4 P0 de esta auditoría fue detectado por la
suite** — las fotos rotas dependen del CDN de producción, el bug del
MapPicker vive en el `<script>` cliente con GPS denegado (seam no cubierto),
la fuga de coordenadas es de capa SQL, y el `id_source` es de Edge Function.

| Flow (catálogo §2) | Verificación en esta auditoría | Hallazgos que lo afectan |
| --- | --- | --- |
| guest-browse | ✅ en vivo (home→explore→recent→species) + e2e | **§1.1 P0 fotos rotas**, §1.2 mapa vacío, §1.3 pill 0% |
| first-observation | ⚠️ parcial: dropzone en vivo (anon), e2e render-only | **§2.2-C1 P0 (0,0) sin asDraft**; sin camino para obs sin media (§3.2) |
| identify-cascade | ⚠️ e2e render-only; `/identify` en vivo | §1.4 redirect sin identidad; claves muertas del confidence-ceiling |
| share-observation | ✅ en vivo (`/share/obs/?id=…`) + e2e locale-neutral | foto hero OK; miniaturas rotas (§1.1); fecha duplicada |
| auth-magic-link | ⚠️ página sign-in en vivo; callback solo e2e (mock PKCE) | §1.6 copy "magic link" vs "Send code" |
| auth-passkey | ⚠️ solo e2e (render del surface) | — |
| watchlist | ⚠️ solo e2e (render authed) | XSS en WatchlistView (§2.1-H1) |
| social-engage | ⚠️ community en vivo (anon); inbox solo e2e | XSS en PlaceDetailView, avatares vacíos, "last seen —" |
| researcher-export | ⚠️ solo e2e (render) | **§2.1-C3 `GET /api/export` devuelve 500** (la página renderiza, el endpoint API está roto) |
| projects-camera | ⚠️ solo e2e (render) | duplicados del CLI al reanudar (§2.5) |
| moderation-triage / console | ❌ no ejecutable (requiere role:admin) | JWT pineado → 401 tras ~1 h (§2.2-M) |
| falta-dex | ⚠️ solo e2e | `/es/perfil/listas/` 404 en el flujo vecino de perfil (§2.3) |
| onboarding | ⚠️ solo e2e (replay 7 pasos) | clave localStorage fuera de convención (§1.4) |
| offline-pwa | ⚠️ solo e2e | `pwa.spec.ts` (manifest) lleva skipeado completo (§2.4-M) |
| mobile-chrome | ✅ e2e local 90/90 (Pixel 5, sin overflow horizontal) | — (no verificado visualmente en vivo) |
| chat-ask-rastrum | ⚠️ chooser de modelos en vivo; flujo con modelo mockeado | — |

**Journeys NO cubiertos por ninguna fuente** (requieren sesión real con
escrituras): crear observación end-to-end con sync a Supabase, validar/sugerir
ID de otro usuario, follow/report real, donación a pool, y los 36 tabs de
consola con escrituras (el catálogo los marca `R+W` sin spec). Son exactamente
los caminos donde viven C1/C2 del backend (§2.1) — recomendación: una sesión
de sweep manual autenticada siguiendo el procedimiento §3 del catálogo (la
última fue 2026-05-16/17, anterior a los PRs de fotos #1206), más los tests
RLS de columna propuestos en §2.1-C1.

---

# Parte 5 — Plan sugerido post-auditoría (estado 2026-06-11)

Agrupación por gate de CI compartido (lección #1015: lo que comparte gate va
junto; lo independiente, separado). Estado al cierre de esta auditoría:

## Hecho
- ✅ Cloudflare Image Transformations habilitado (2026-06-11) — fotos de
  explore restauradas. Ver resolución y plan de quota en §1.1.

## Fase 1 — esta semana (P0/P1, 5 PRs)
1. **PR media-resilience**: fallback `onerror` en el `<picture>` de
   `ExploreRecentView` + matriz 2×1 (AVIF) en `image-variants.ts` + probe de
   `cdn-cgi/image` en `infra/smoke-model-assets.sh`. Protege contra el
   agotamiento del quota de 5k/mes. (§1.1)
2. **PR seguridad schema** (gate `db-validate`): `REVOKE SELECT (location)`
   + ownership-check en `upsert_primary_identification` + `<> 'full'` en
   `profile_pokedex` + tests RLS de columna. (§2.1-C1/C2/M)
3. **PR Edge Functions** (deploy conjunto): `id_source`→`source` en `api`,
   scope de usuario en `get-upload-url`, auth en `enrich-environment`.
   (§2.1-C3/M)
4. **PR cliente crítico**: listener `rastrum:mappicker-save` en ObserveView2
   + `asDraft: !location` + `set-initial`, con spec e2e en
   `observe-card.spec.ts`. (§2.2-C1)
5. **PR integridad CI**: borrar `db-validate-noop.yml`, `fetch-depth: 0` +
   fallo ruidoso en `deploy-functions.yml`, consolidar los dos smokes
   nocturnos. (§2.4-H1/H2/H3)

## Fase 2 — siguientes dos semanas (P1/P2)
6. **PR XSS + privacidad cliente**: escapes en PlaceDetailView/WatchlistView
   + ratchet `innerHTML`-sin-`escape.ts`; quitar `lat/lng` del querystring en
   HomeNearby; eliminar tier `PUBLIC_ANTHROPIC_KEY`. (§2.1-H1/H2/H3)
7. **PR rutas/i18n**: `/es/perfil/listas/`, entradas `routes{}` para los 9
   pares asimétricos, `DocsIndexView`/`PlacesCompareView` compartidos,
   sitemap-hreflang importando rutas del módulo. (§2.3)
8. **PR a11y**: sweep emerald-600→700 (~17 archivos; ojo con los dos
   `classList` — single-token) + cuarta regla en
   `color-contrast-policy.test.ts`; aria-labels a i18n. (§2.6)
9. **Sweep manual autenticado** del journey catalog (§3 del catálogo),
   actualizando fechas `Verified` — prioridad: first-observation y validate.
   La última pasada (2026-05-16/17) fue anterior al PR #1206. (Parte 4)

## Fase 3 — backlog estructural (convertir en issues)
10. **Thumbnails en upload** (diseño en §1.1-Resolución): elimina la
    dependencia del quota de Cloudflare; alinea con la meta zero-cost.
11. **Tests de comportamiento para `sync.ts`/`auth.ts`/`db.ts`/`upload.ts`**
    — los módulos más críticos sin cobertura real. (§2.4-M)
12. **Robustez del CLI**: try/finally + log atómico + timeouts (previene
    observaciones duplicadas en re-runs de campo). (§2.5)
13. **Parser multilínea en `check-rls-coverage.sh`** + self-test de conteo.
    (§2.4-M)
14. **UX explore**: fitBounds + empty-state del mapa; pill "Needs ID" en vez
    de 0%; home con stats vivos. (§1.2/§1.3/§1.7 y Parte 3)
15. Fixes UX menores agrupables: breadcrumb duplicado de docs, copy de
    sign-in, identidad del modo identify, JWT por llamada en consola,
    consent→PostHog, footer (Install/Mastodon/RSS). (§1.4-1.6, §2.2-M)

---

# Apéndice — Verificado correcto (para no re-flagear)

- Privacidad: `community-url.ts` mantiene GPS fuera del querystring
  (sessionStorage only); `byo-keys.ts` nunca networkea ni loguea keys; el
  firewall R1–R3 (`identification-source.ts`, `confidence-ceiling.ts`,
  `source-trust.ts`) se comporta como está documentado (salvo las claves
  muertas del ceiling, §2.2).
- Backend: las 21 vistas `public` son `security_invoker=true`; los SECURITY
  DEFINER sensibles (vault, pools, sponsorship, karma) tienen REVOKE+grant
  mínimo; el dispatcher `admin` re-verifica JWT, roles, rate-limit y audita;
  los crons usan `requireCronSecret`.
- i18n: paridad 3503/3503 claves EN/ES; cero regresiones `/share/obs/`;
  120/120 páginas pareadas; safelist Tailwind completo para `railClass()` y
  MegaMenu.
- Tests/CI: `set -euo pipefail` en los 13 scripts; TZ pinned en vitest y
  Playwright; sin archivos `.flaky.` en cuarentena; sw.js protege
  PERSISTENT_CACHES correctamente y el slicing 206 es correcto (con el matiz
  de rangos abiertos, §2.4).
- PWA: manifest con iconos/screenshots existentes; robots/sitemap coherentes
  con `@astrojs/sitemap`; redirects de `astro.config.mjs` coherentes.
