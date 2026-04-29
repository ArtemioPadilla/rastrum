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

  if (sciInput)   sciInput.value   = '';
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
      const payload = buildDetailsUpdatePayload({
        notes: notesEl?.value ?? '',
        obscure_level: obsEl?.value ?? 'none',
        observed_at_local: observedAt?.value ?? '',
        habitat: habitatEl?.value ?? '',
        weather: weatherEl?.value ?? '',
        establishment_means: estabEl?.value ?? '',
      });
      const { error: obsErr } = await supabase
        .from('observations')
        .update(payload)
        .eq('id', obsId);
      if (obsErr) throw obsErr;

      const sci = sciInput?.value.trim();
      if (sci) {
        await supabase.from('identifications')
          .update({ is_primary: false })
          .eq('observation_id', obsId)
          .eq('is_primary', true);
        const { data: { user: viewer } } = await supabase.auth.getUser();
        const { error: idErr } = await supabase.from('identifications').insert({
          observation_id: obsId,
          scientific_name: sci,
          confidence: 0.95,
          source: 'human',
          is_primary: true,
          validated_by: null,
          validated_at: new Date().toISOString(),
          raw_response: { manual_override: true, by: viewer?.id ?? null },
        });
        if (idErr) throw idErr;
      }

      savedEl?.classList.remove('hidden');
      const speciesEl = document.getElementById('species');
      if (sci && speciesEl) speciesEl.textContent = sci;
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

/**
 * Build the WKT geography literal Postgres expects for a `geography(POINT,4326)`
 * column. Note longitude precedes latitude per PostGIS / GeoJSON convention,
 * matching how `src/lib/sync.ts` and `ObservationForm.astro` write coords.
 */
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
    const tree = (await import('../i18n/utils')).t(lang) as {
      obs_detail: { location: { no_location: string } };
    };
    if (coordsEl) coordsEl.textContent = tree.obs_detail.location.no_location;
  }

  const savingEl = document.getElementById('m-loc-saving');
  const savedEl  = document.getElementById('m-loc-saved');
  const errEl    = document.getElementById('m-loc-error');

  window.addEventListener('rastrum:mappicker-save', async (ev) => {
    const e = ev as CustomEvent<{ id: string; coords: { lat: number; lng: number } }>;
    if (e.detail.id !== 'obs-detail-edit') return;
    errEl?.classList.add('hidden');
    savedEl?.classList.add('hidden');
    savingEl?.classList.remove('hidden');
    try {
      const literal = pointGeographyLiteral(e.detail.coords.lat, e.detail.coords.lng);
      const { error } = await supabase
        .from('observations')
        .update({ location: literal, updated_at: new Date().toISOString() })
        .eq('id', obsId);
      if (error) throw error;

      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set', {
        detail: { id: 'obs-detail-loc-view', coords: e.detail.coords },
      }));
      window.dispatchEvent(new CustomEvent('rastrum:mappicker-set-initial', {
        detail: { id: 'obs-detail-edit', coords: e.detail.coords },
      }));
      const coordsEl = document.querySelector<HTMLElement>('[data-loc-coords]');
      if (coordsEl) coordsEl.textContent = `${e.detail.coords.lat.toFixed(4)}, ${e.detail.coords.lng.toFixed(4)}`;
      savedEl?.classList.remove('hidden');
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (errEl) {
        errEl.textContent = code === 'coords_invalid' ? errCopy.invalidCoords : errCopy.saveFailed;
        errEl.classList.remove('hidden');
      }
    } finally {
      savingEl?.classList.add('hidden');
    }
  });
}
