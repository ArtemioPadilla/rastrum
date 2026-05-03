// Owner-only Manage panel logic for the obs detail page. Extracted from
// the inline `wireManagePanel(...)` that lived in
// `src/pages/share/obs/index.astro` so the Details tab fields can be
// covered by unit tests and so PR5 / PR6 can extend with Location +
// Photos handlers without bloating the page script.
//
// Material-edit detection happens server-side via the
// `observations_material_edit_check` BEFORE UPDATE trigger (PR2). The
// client only issues plain `update(...)` calls — no application-side
// flagging is needed.

import { getSupabase } from './supabase';
import { willDemote, type PhotoForDeletion } from './photo-deletion';
import { resizeImage, uploadMedia } from './upload';
import { escapeHtml as escAttr } from './escape';
import { t } from '../i18n/utils';
import { openConfirmDialog } from './confirm-dialog';
import { correctIdentificationName } from './taxonomy-synonyms';

type Ident = { scientific_name?: string; is_primary?: boolean } | undefined;

type SaveCopy = {
  saving: string;
  delete_confirm: string;
};

/**
 * Format an ISO timestamp ("2026-04-29T18:30:00Z") for an
 * `<input type="datetime-local">` value in the browser's local TZ
 * ("2026-04-29T11:30").
 */
export function isoToLocalDatetimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert a `<input type="datetime-local">` value (browser-local) to a
 * UTC ISO string ready for a Postgres `timestamptz` column.
 */
export function localDatetimeInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type DetailsFormPayload = {
  notes: string | null;
  obscure_level: string;
  observed_at: string | null;
  habitat: string | null;
  weather: string | null;
  establishment_means: string | null;
};

/**
 * Build the partial `observations` row for an UPDATE. Empty strings
 * collapse to `null` so the column clears rather than storing "". The
 * `observed_at` field is omitted from the returned object when the
 * input value is empty so the existing column value isn't nulled
 * accidentally.
 */
export function buildDetailsUpdatePayload(form: {
  notes: string;
  obscure_level: string;
  observed_at_local: string;
  habitat: string;
  weather: string;
  establishment_means: string;
}): Partial<DetailsFormPayload> & { updated_at: string } {
  const out: Partial<DetailsFormPayload> & { updated_at: string } = {
    notes: form.notes.trim() || null,
    obscure_level: form.obscure_level || 'none',
    habitat: form.habitat || null,
    weather: form.weather || null,
    establishment_means: form.establishment_means || null,
    updated_at: new Date().toISOString(),
  };
  const iso = localDatetimeInputToIso(form.observed_at_local);
  if (iso) out.observed_at = iso;
  return out;
}

/**
 * Wire the Details tab of `ObsManagePanel.astro`. Pre-populates every
 * field from the loaded observation, then attaches submit / delete
 * handlers that round-trip changes through Supabase.
 */
export async function wireManagePanelDetails(
  obsId: string,
  obs: Record<string, unknown>,
  _ident: Ident,
): Promise<void> {
  const supabase = getSupabase();
  const panel = document.getElementById('manage-panel');
  if (!panel) return;
  panel.classList.remove('hidden');

  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const copy: SaveCopy = lang === 'es'
    ? {
        saving: 'Guardando…',
        delete_confirm: '¿Eliminar esta observación? Esta acción no se puede deshacer. Las fotos, identificaciones y metadatos se eliminarán.',
      }
    : {
        saving: 'Saving…',
        delete_confirm: 'Delete this observation? This cannot be undone. Photos, identifications, and metadata will all be removed.',
      };

  const sciInput   = document.getElementById('m-sci')           as HTMLInputElement | null;
  const notesEl    = document.getElementById('m-notes')         as HTMLTextAreaElement | null;
  const obsEl      = document.getElementById('m-obscure')       as HTMLSelectElement | null;
  const observedAt = document.getElementById('m-observed-at')   as HTMLInputElement | null;
  const habitatEl  = document.getElementById('m-habitat')       as HTMLSelectElement | null;
  const weatherEl  = document.getElementById('m-weather')       as HTMLSelectElement | null;
  const estabEl    = document.getElementById('m-establishment') as HTMLSelectElement | null;
  const errEl      = document.getElementById('m-error');
  const savedEl    = document.getElementById('m-saved');
  const saveBtn    = document.getElementById('m-save')          as HTMLButtonElement | null;
  const deleteBtn  = document.getElementById('m-delete')        as HTMLButtonElement | null;
  const form       = document.getElementById('manage-form')     as HTMLFormElement | null;

  if (sciInput)   sciInput.value   = (_ident?.scientific_name as string | null) ?? '';
  if (notesEl)    notesEl.value    = (obs.notes as string | null) ?? '';
  if (obsEl)      obsEl.value      = (obs.obscure_level as string) ?? 'none';
  if (observedAt) observedAt.value = isoToLocalDatetimeInput(obs.observed_at as string | null | undefined);
  if (habitatEl)  habitatEl.value  = (obs.habitat as string | null) ?? '';
  if (weatherEl)  weatherEl.value  = (obs.weather as string | null) ?? '';
  if (estabEl)    estabEl.value    = (obs.establishment_means as string | null) ?? '';

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!saveBtn) return;
    errEl?.classList.add('hidden');
    savedEl?.classList.add('hidden');
    saveBtn.disabled = true;
    const origLabel = saveBtn.textContent ?? 'Save';
    saveBtn.textContent = copy.saving;
    try {
      // Offline guard: if we're offline, save the species override locally
      // and queue it for sync. The observation details (notes, habitat, etc.)
      // are server-only fields that can wait, but the species name is critical
      // for the user's workflow.
      if (!navigator.onLine) {
        const sci = sciInput?.value.trim();
        if (sci) {
          // Apply taxonomy synonym correction for known outdated names
          const correctedSci = correctIdentificationName(sci);
          // Update the Dexie record's identification data
          try {
            const { getDB } = await import('./db');
            const db = getDB();
            const record = await db.observations.get(obsId);
            if (record && record.data) {
              record.data.identification = {
                ...record.data.identification,
                scientificName: correctedSci,
                source: 'human' as const,
                status: 'accepted' as const,
                confidence: 0.95,
              };
              // Always flip to 'pending' — records stuck in 'error' or 'draft'
              // must also re-enter the sync queue after a species correction.
              await db.observations.update(obsId, {
                data: record.data,
                sync_status: 'pending',
                updated_at: new Date().toISOString(),
              });
              savedEl?.classList.remove('hidden');
              const speciesEl = document.getElementById('species');
              if (speciesEl) speciesEl.textContent = correctedSci;
              // If the user typed an outdated name, update the input
              if (correctedSci !== sci && sciInput) sciInput.value = correctedSci;
              // Show offline indicator
              if (savedEl) {
                savedEl.textContent = lang === 'es'
                  ? '✓ Guardado localmente — se sincronizará cuando haya conexión'
                  : '✓ Saved locally — will sync when online';
              }
            } else {
              throw new Error('Observation not found in local database');
            }
          } catch (dbErr) {
            if (errEl) {
              errEl.textContent = lang === 'es'
                ? 'Error al guardar localmente. Intenta de nuevo con conexión.'
                : 'Error saving locally. Try again when online.';
              errEl.classList.remove('hidden');
            }
          }
        } else {
          if (errEl) {
            errEl.textContent = lang === 'es'
              ? 'Sin conexión — solo se puede guardar el nombre de especie offline'
              : 'Offline — only species name can be saved offline';
            errEl.classList.remove('hidden');
          }
        }
        saveBtn.disabled = false;
        saveBtn.textContent = origLabel;
        return;
      }

      const payload = buildDetailsUpdatePayload({
        notes: notesEl?.value ?? '',
        obscure_level: obsEl?.value ?? 'none',
        observed_at_local: observedAt?.value ?? '',
        habitat: habitatEl?.value ?? '',
        weather: weatherEl?.value ?? '',
        establishment_means: estabEl?.value ?? '',
      });

      // Wrap the entire online save in a timeout so the button never
      // stays disabled indefinitely (e.g. stale auth lock, network limbo).
      const SAVE_TIMEOUT_MS = 15_000;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          lang === 'es'
            ? 'La operación tardó demasiado. Verifica tu conexión e intenta de nuevo.'
            : 'Operation timed out. Check your connection and try again.'
        )), SAVE_TIMEOUT_MS),
      );

      await Promise.race([timeout, (async () => {
        const { error: obsErr } = await supabase
          .from('observations')
          .update(payload)
          .eq('id', obsId);
        if (obsErr) throw obsErr;

        const sci = sciInput?.value.trim();
        if (sci) {
          // Apply taxonomy synonym correction for known outdated names (#345)
          const correctedSci = correctIdentificationName(sci);
          // Demote the current primary identification. Capture the error —
          // if RLS rejects this (stale session, wrong owner), we must not
          // proceed to the insert or the unique partial index will reject it.
          const { error: demoteErr } = await supabase.from('identifications')
            .update({ is_primary: false })
            .eq('observation_id', obsId)
            .eq('is_primary', true);
          if (demoteErr) throw demoteErr;

          let viewerId: string | null = null;
          try {
            const { data: { user: viewer } } = await supabase.auth.getUser();
            viewerId = viewer?.id ?? null;
          } catch {
            // Auth fetch failed — proceed without viewer ID rather than hang
          }

          const { error: idErr } = await supabase.from('identifications').insert({
            observation_id: obsId,
            scientific_name: correctedSci,
            confidence: 0.95,
            source: 'human',
            is_primary: true,
            validated_by: null,
            validated_at: new Date().toISOString(),
            raw_response: { manual_override: true, by: viewerId },
          });
          if (idErr) throw idErr;
        }
      })()]);

      savedEl?.classList.remove('hidden');
      const sci = sciInput?.value.trim();
      if (sci) {
        const correctedSci = correctIdentificationName(sci);
        const speciesEl = document.getElementById('species');
        if (speciesEl) speciesEl.textContent = correctedSci;
        // If the user typed an outdated name, update the input to show the correction
        if (correctedSci !== sci && sciInput) sciInput.value = correctedSci;
      }
      // Notify the page that identification data changed so it can
      // re-fetch community IDs and other dependent sections.
      window.dispatchEvent(new CustomEvent('rastrum:observation-updated', {
        detail: { observationId: obsId },
      }));
    } catch (err) {
      if (errEl) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
        errEl.classList.remove('hidden');
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = origLabel;
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    const confirmed = window.confirm(copy.delete_confirm);
    if (!confirmed) return;
    deleteBtn.disabled = true;
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        ok: boolean; r2_deleted?: number; r2_errors?: unknown[]; error?: string;
      }>('delete-observation', {
        body: { observation_id: obsId },
      });
      if (invokeErr) throw invokeErr;
      if (data && !data.ok) throw new Error(data.error ?? 'Delete failed');
      window.location.href = `/${lang}/${lang === 'es' ? 'perfil/observaciones' : 'profile/observations'}/`;
    } catch (err) {
      if (errEl) {
        errEl.textContent = err instanceof Error ? err.message : String(err);
        errEl.classList.remove('hidden');
      }
      deleteBtn.disabled = false;
    }
  });
}

type PhotoRow = PhotoForDeletion & {
  url: string;
  thumbnail_url: string | null;
  sort_order: number | null;
};

type PhotosCopy = {
  delete_confirm_demote: string;
  delete_confirm_simple: string;
  delete_confirm_title: string;
  delete_confirm_label: string;
  upload_failed: string;
  uploading: string;
  delete_photo_aria: string;
};

/**
 * Wire the Photos tab of `ObsManagePanel.astro`. Renders a thumbnail grid
 * with per-photo delete buttons and an "Add photo" affordance that
 * round-trips through the existing R2 upload flow.
 *
 * Delete flow:
 *   1. Compute willDemote() locally to drive the confirm dialog copy.
 *   2. Call the `delete-photo` Edge Function which wraps soft-delete +
 *      ID demote + last_material_edit_at bump in one transaction.
 *   3. Re-render grid + dispatch `rastrum:photos-ready` so the PhotoGallery
 *      lightbox refreshes.
 *
 * Add-photo flow:
 *   1. Hidden <input type="file"> click → resize → uploadMedia (R2 if
 *      configured, else Supabase Storage).
 *   2. INSERT a media_files row with sort_order = max+1, is_primary=false.
 *   3. Re-render + dispatch `rastrum:photos-ready`.
 *
 * The lightbox's owner-mode "Delete photo" button dispatches
 * `rastrum:photogallery-delete`; this function listens for that event
 * and re-routes through the same delete pipeline.
 */
export async function wireManagePanelPhotos(obsId: string): Promise<void> {
  const supabase = getSupabase();
  const grid     = document.getElementById('m-photos-grid');
  const empty    = document.getElementById('m-photos-empty');
  const errEl    = document.getElementById('m-photos-error');
  const addBtn   = document.getElementById('m-photos-add')        as HTMLButtonElement | null;
  const fileIn   = document.getElementById('m-photos-file-input') as HTMLInputElement  | null;
  const busyEl   = document.getElementById('m-photos-busy');
  if (!grid || !addBtn || !fileIn) return;

  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const copy: PhotosCopy = lang === 'es'
    ? {
        delete_confirm_demote: 'Esta foto fue la base de la identificación actual. Eliminarla marcará la observación como pendiente de revisión. ¿Continuar?',
        delete_confirm_simple: '¿Eliminar esta foto?',
        delete_confirm_title:  'Eliminar foto',
        delete_confirm_label:  'Eliminar',
        upload_failed:         'Subida de foto fallida. Intenta de nuevo.',
        uploading:             'Subiendo…',
        delete_photo_aria:     'Eliminar foto',
      }
    : {
        delete_confirm_demote: 'This photo was the basis for the current identification. Deleting it will mark the observation as needing review. Continue?',
        delete_confirm_simple: 'Delete this photo?',
        delete_confirm_title:  'Delete photo',
        delete_confirm_label:  'Delete',
        upload_failed:         'Photo upload failed. Please try again.',
        uploading:             'Uploading…',
        delete_photo_aria:     'Delete photo',
      };

  let allPhotos: PhotoRow[] = [];

  function setError(msg: string | null): void {
    if (!errEl) return;
    if (!msg) { errEl.classList.add('hidden'); errEl.textContent = ''; return; }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  function setBusy(msg: string | null): void {
    if (!busyEl) return;
    if (!msg) { busyEl.classList.add('hidden'); busyEl.textContent = ''; return; }
    busyEl.textContent = msg;
    busyEl.classList.remove('hidden');
  }

  function renderGrid(): void {
    const active = allPhotos.filter((p) => p.deleted_at == null);
    if (empty) empty.classList.toggle('hidden', active.length > 0);
    grid!.innerHTML = active.map((p) => {
      const src   = p.thumbnail_url ?? p.url;
      const aria  = escAttr(copy.delete_photo_aria);
      const idAt  = escAttr(p.id);
      const srcAt = escAttr(src);
      const cascadeBadge = p.is_primary
        ? '<span class="absolute top-1 left-1 rounded bg-emerald-700/85 text-white text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wide">★</span>'
        : '';
      return `<div class="relative group">
        <img src="${srcAt}" alt="" class="aspect-square w-full object-cover rounded-md border border-zinc-200 dark:border-zinc-800" loading="lazy" decoding="async" />
        ${cascadeBadge}
        <button type="button" data-delete-photo="${idAt}" aria-label="${aria}" class="absolute top-1 right-1 rounded-full bg-black/60 hover:bg-red-600 text-white w-6 h-6 inline-flex items-center justify-center text-xs leading-none transition-colors">×</button>
      </div>`;
    }).join('');
    grid!.querySelectorAll<HTMLButtonElement>('[data-delete-photo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.deletePhoto;
        if (id) void handleDelete(id);
      });
    });
  }

  function broadcastPhotos(): void {
    const active = allPhotos.filter((p) => p.deleted_at == null);
    window.dispatchEvent(new CustomEvent('rastrum:photos-ready', {
      detail: {
        photos: active.map((p) => ({
          id: p.id, url: p.url, thumbnail_url: p.thumbnail_url, caption: null,
        })),
        galleryId: 'obs-detail',
      },
    }));
  }

  async function refresh(): Promise<void> {
    const { data, error } = await supabase
      .from('media_files')
      .select('id, url, thumbnail_url, is_primary, sort_order, deleted_at')
      .eq('observation_id', obsId)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true });
    if (error) {
      setError(error.message);
      allPhotos = [];
    } else {
      allPhotos = (data ?? []) as PhotoRow[];
    }
    renderGrid();
    broadcastPhotos();
  }

  async function handleDelete(mediaId: string): Promise<void> {
    setError(null);
    const demote = willDemote(allPhotos, mediaId);
    const msg = demote ? copy.delete_confirm_demote : copy.delete_confirm_simple;
    const ok = await openConfirmDialog({
      title: copy.delete_confirm_title,
      message: msg,
      confirmLabel: copy.delete_confirm_label,
      variant: 'danger',
    });
    if (!ok) return;

    const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
      'delete-photo',
      { body: { observation_id: obsId, media_id: mediaId, will_demote: demote } },
    );
    if (error) { setError(error.message); return; }
    if (data && !data.ok) { setError(data.error ?? 'Delete failed'); return; }
    await refresh();
  }

  addBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const files = Array.from(fileIn.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setBusy(copy.uploading);
    addBtn.disabled = true;
    try {
      // Determine starting sort_order so new photos append after existing ones.
      const maxSort = allPhotos.reduce((acc, p) => {
        const so = p.sort_order ?? 0;
        return so > acc ? so : acc;
      }, 0);

      let nextSort = maxSort + 1;
      for (const file of files) {
        const blob   = await resizeImage(file);
        const newId  = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const key    = `observations/${obsId}/${newId}.jpg`;
        const url    = await uploadMedia(blob, key, 'image/jpeg');
        const { error: insertErr } = await supabase.from('media_files').insert({
          id:               newId,
          observation_id:   obsId,
          media_type:       'photo',
          url,
          mime_type:        'image/jpeg',
          file_size_bytes:  blob.size,
          sort_order:       nextSort,
          is_primary:       false,
        });
        if (insertErr) throw insertErr;
        nextSort += 1;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.upload_failed);
    } finally {
      addBtn.disabled = false;
      setBusy(null);
      fileIn.value = '';
    }
  });

  // Lightbox owner-mode delete button dispatches this from PhotoGallery.
  window.addEventListener('rastrum:photogallery-delete', (e) => {
    const detail = (e as CustomEvent<{ photoId?: string; galleryId?: string }>).detail;
    if (!detail || !detail.photoId) return;
    if ((detail.galleryId ?? 'default') !== 'obs-detail') return;
    void handleDelete(detail.photoId);
  });

  await refresh();
}

/**
 * Build a GeoJSON Point object for PostgREST / supabase-js UPDATE calls on
 * `geography(Point,4326)` columns. PostgREST accepts WKT on INSERT via the
 * PostgREST type-casting path, but UPDATE through supabase-js serialises the
 * value as JSON — sending a raw WKT string results in a no-op write (the
 * column stays at its old value). GeoJSON is the safe format for both paths.
 *
 * Note: longitude precedes latitude per GeoJSON spec.
 */
export function pointGeographyGeoJSON(lat: number, lng: number): { type: 'Point'; coordinates: [number, number] } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('coords_invalid');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('coords_invalid');
  }
  return { type: 'Point', coordinates: [lng, lat] };
}

/** @deprecated Use pointGeographyGeoJSON — WKT silently no-ops on UPDATE via supabase-js */
export function pointGeographyLiteral(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('coords_invalid');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('coords_invalid');
  }
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * Wire the Location tab of `ObsManagePanel.astro`. Listens for the
 * `rastrum:mappicker-save` event with `detail.id === 'obs-detail-edit'`,
 * UPDATEs `observations.location`, and lets the existing
 * `observations_material_edit_check_trg` trigger flag
 * `last_material_edit_at` for moves > 1 km. The trigger is server-side,
 * so no application flag is set here.
 *
 * RLS gates the UPDATE on `auth.uid() = observer_id`, so non-owners can't
 * land here even if they spoof the event.
 */
export async function wireManagePanelLocation(
  obsId: string,
  obs: Record<string, unknown>,
): Promise<void> {
  const supabase = getSupabase();
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const isEs = lang === 'es';
  const errCopy = isEs
    ? { saveFailed: 'No se pudo guardar la ubicación.', invalidCoords: 'Coordenadas no válidas.' }
    : { saveFailed: 'Failed to save location.',         invalidCoords: 'Invalid coordinates.' };

  // Pre-populate both pickers (view + edit modal) with the current coords
  // pulled off the loaded observation. The location is a GeoJSON Point;
  // PostgREST returns it as { coordinates: [lng, lat] }.
  const loc = obs.location as { coordinates?: [number, number] } | null | undefined;
  const coords = loc?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = coords[0];
    const lat = coords[1];
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set', {
        detail: { id: 'obs-detail-loc-view', coords: { lat, lng } },
      }));
      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set-initial', {
        detail: { id: 'obs-detail-edit', coords: { lat, lng } },
      }));
      const coordsEl = document.querySelector<HTMLElement>('[data-loc-coords]');
      if (coordsEl) coordsEl.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  } else {
    const coordsEl = document.querySelector<HTMLElement>('[data-loc-coords]');
    const tree = t(lang) as { obs_detail: { location: { no_location: string } } };
    if (coordsEl) coordsEl.textContent = tree.obs_detail.location.no_location;
  }

  const savingEl = document.getElementById('m-loc-saving');
  const savedEl  = document.getElementById('m-loc-saved');
  const errEl    = document.getElementById('m-loc-error');

  // GPS button — use device location
  const gpsBtn = document.getElementById('m-loc-gps') as HTMLButtonElement | null;
  if (gpsBtn && 'geolocation' in navigator) {
    gpsBtn.classList.remove('hidden');
    gpsBtn.addEventListener('click', () => {
      const gpsStatus = document.getElementById('m-loc-gps-status');
      gpsBtn.disabled = true;
      if (gpsStatus) { gpsStatus.textContent = isEs ? 'Obteniendo ubicación…' : 'Getting location…'; gpsStatus.classList.remove('hidden'); }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          gpsBtn.disabled = false;
          if (gpsStatus) gpsStatus.classList.add('hidden');
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          window.dispatchEvent(new CustomEvent('rastrum:mappicker-set-initial', { detail: { id: 'obs-detail-edit', coords } }));
          window.dispatchEvent(new CustomEvent('rastrum:mappicker-set', { detail: { id: 'obs-detail-edit', coords } }));
        },
        (err) => {
          gpsBtn.disabled = false;
          if (gpsStatus) { gpsStatus.textContent = isEs ? 'No se pudo obtener la ubicación GPS.' : 'Could not get GPS location.'; }
          console.warn('[manage-panel] GPS error', err);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }

  // Use a named handler so we can remove any previously registered listener
  // before adding a new one. wireManagePanelLocation can be called more than
  // once (page navigation, panel re-init), and window.addEventListener without
  // cleanup stacks duplicate listeners — each one fires on the same event,
  // causing concurrent refreshSession() + RPC calls that deadlock the
  // supabase-js auth mutex and trigger save_timeout.
  const existingHandler = (window as Window & { __rastrum_loc_handler?: EventListener }).__rastrum_loc_handler;
  if (existingHandler) window.removeEventListener('rastrum:mappicker-save', existingHandler);

  const locHandler: EventListener = async (ev) => {
    const e = ev as CustomEvent<{ id: string; coords: { lat: number; lng: number } }>;
    if (e.detail.id !== 'obs-detail-edit') return;
    errEl?.classList.add('hidden');
    savedEl?.classList.add('hidden');
    savingEl?.classList.remove('hidden');
    try {
      // GeoJSON format is required for UPDATE via supabase-js — WKT strings are
      // PostgREST cannot implicitly cast jsonb → geography (requires owning both
      // types). Use the RPC function instead — it accepts lat/lng as floats
      // and builds the geography internally with ST_MakePoint.
      //
      // Include both refreshSession + RPC inside the single 15 s timeout so
      // a hanging auth refresh doesn’t eat the whole budget before the RPC
      // even starts. refreshSession is capped at 5 s; on failure we proceed
      // with the existing token (the RPC will fail with 401 if truly expired,
      // which shows the session-expired error instead of a generic timeout).
      const refreshPromise = Promise.race([
        supabase.auth.refreshSession(),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ]).catch(() => { /* non-fatal */ });
      // Hard 15 s timeout on the full operation (refresh + RPC).
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('save_timeout')), 15_000),
      );
      const updatePromise = refreshPromise.then(() => {
        // Log params before calling RPC to verify they are valid
        // console.warn so ReportIssueButton captures it in __rastrum_diag
        console.warn('[manage-panel] calling update_observation_location', {
          p_obs_id: obsId,
          p_lat: e.detail.coords.lat,
          p_lng: e.detail.coords.lng,
        });
        return supabase.rpc('update_observation_location', {
          p_obs_id: obsId,
          p_lat:    e.detail.coords.lat,
          p_lng:    e.detail.coords.lng,
        });
      });
      const result = await Promise.race([updatePromise, timeout]) as { error: { message?: string; code?: string } | null };
      if (result.error) {
        // Log full error details so the console report includes the actual
        // Supabase/PostgREST message instead of "[object Object]"
        const errMsg = result.error.message ?? result.error.code ?? 'unknown';
        const errCode = (result.error as { code?: string }).code ?? '';
        const errDetails = (result.error as { details?: string }).details ?? '';
        const errHint = (result.error as { hint?: string }).hint ?? '';
        console.error('[manage-panel] location update failed', {
          obsId,
          message: errMsg,
          code: errCode,
          details: errDetails,
          hint: errHint,
        });
        throw new Error(`${errCode ? errCode + ': ' : ''}${errMsg}`);
      }

      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set', {
        detail: { id: 'obs-detail-loc-view', coords: e.detail.coords },
      }));
      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set-initial', {
        detail: { id: 'obs-detail-edit', coords: e.detail.coords },
      }));
      // Also update the main obs-detail header map and coords text
      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set', {
        detail: { id: 'obs-detail', coords: e.detail.coords },
      }));
      const coordStr = `${e.detail.coords.lat.toFixed(4)}, ${e.detail.coords.lng.toFixed(4)}`;
      // Update both the manage-panel coords text and the main header coords
      const coordsEl = document.querySelector<HTMLElement>('[data-loc-coords]');
      if (coordsEl) coordsEl.textContent = coordStr;
      const obsCoords = document.querySelector<HTMLElement>('[data-obs-coords]');
      if (obsCoords) obsCoords.textContent = coordStr;
      // Remove any "Location not available" placeholder in the header
      const noLocEl = document.querySelector<HTMLElement>('[data-no-location]');
      if (noLocEl) noLocEl.classList.add('hidden');
      savedEl?.classList.remove('hidden');
    } catch (err) {
      // Serialize error properly — supabase-js PostgrestError is a POJO, not an Error
      // instance, so err instanceof Error is false and String(err) = "[object Object]".
      // Use JSON.stringify with a fallback to expose the full error object in the log.
      const safeStr = (v: unknown): string => {
        if (v instanceof Error) return v.message;
        try { return JSON.stringify(v); } catch { return String(v); }
      };
      const code = err instanceof Error ? err.message : safeStr(err);
      console.error('[manage-panel] location save error', safeStr(err));
      if (errEl) {
        // PostgREST 403 = RLS blocked the UPDATE. Most common cause: JWT expired.
        const is403 = code.includes('403') || code.includes('PGRST116') || code.includes('rls_filtered') || code.includes('JWT expired') || code.includes('permission denied');
        if (code === 'coords_invalid' || code.includes('coords_invalid')) {
          errEl.textContent = errCopy.invalidCoords;
        } else if (code === 'save_timeout' || code.includes('save_timeout')) {
          errEl.textContent = isEs
            ? 'Tiempo de espera agotado. Revisa tu conexión o intenta de nuevo.'
            : 'Save timed out. Check your connection and try again.';
        } else if (is403) {
          errEl.textContent = isEs
            ? 'Sesión expirada. Vuelve a iniciar sesión para guardar cambios.'
            : 'Session expired. Sign in again to save changes.';
        } else {
          errEl.textContent = `${errCopy.saveFailed} (${code})`;
        }
        errEl.classList.remove('hidden');
      }
    } finally {
      savingEl?.classList.add('hidden');
    }
  };

  // Register and store the handler so future calls can remove the old one
  window.addEventListener('rastrum:mappicker-save', locHandler);
  (window as Window & { __rastrum_loc_handler?: EventListener }).__rastrum_loc_handler = locHandler;
}
