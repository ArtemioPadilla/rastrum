/**
 * generate-wrapped — Fogg Principle of Self-Monitoring (ch. 3, p. 44).
 *
 * Generates annual stats for a user and caches them in wrapped_cache.
 * Returns: total obs, total species, top species, habitats, streak record,
 * top photo, impact (DwC exports, threatened species).
 *
 * Called from /profile/wrapped/[year] page.
 *
 * Issue #725.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

interface WrappedPayload {
  year: number;
  total_observations: number;
  total_species: number;
  top_species: Array<{ scientific_name: string; common_name_es: string | null; common_name_en: string | null; count: number; thumbnail_url: string | null }>;
  habitats: Array<{ habitat: string; count: number }>;
  longest_streak_days: number;
  first_obs_date: string | null;
  last_obs_date: string | null;
  top_photo_url: string | null;
  top_photo_obs_id: string | null;
  dwc_export_count: number;
  threatened_species_count: number;
  peak_hour: number | null;
  generated_at: string;
}

serve(async (req) => {
  // Auth: the caller must be authenticated (JWT checked by Supabase gateway)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url_env  = Deno.env.get('SUPABASE_URL');
  const role_env = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url_env || !role_env) return new Response('Function not configured', { status: 500 });

  // Parse query params
  const reqUrl = new URL(req.url);
  const yearStr = reqUrl.searchParams.get('year');
  const userId  = reqUrl.searchParams.get('user_id');
  if (!yearStr || !userId) {
    return new Response('Missing year or user_id', { status: 400 });
  }
  const year = parseInt(yearStr, 10);
  if (isNaN(year) || year < 2020 || year > new Date().getFullYear()) {
    return new Response('Invalid year', { status: 400 });
  }

  const db = createClient(url_env, role_env);

  // -------------------------------------------------------------------------
  // Check cache first
  // -------------------------------------------------------------------------
  const { data: cached } = await db
    .from('wrapped_cache')
    .select('payload, generated_at')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle<{ payload: WrappedPayload; generated_at: string }>();

  // Cache valid for 24h
  if (cached) {
    const cacheAge = Date.now() - new Date(cached.generated_at).getTime();
    if (cacheAge < 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify(cached.payload), {
        headers: { 'content-type': 'application/json', 'x-cache': 'HIT' },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Generate fresh stats
  // -------------------------------------------------------------------------
  const yearStart = `${year}-01-01T00:00:00Z`;
  const yearEnd   = `${year}-12-31T23:59:59Z`;

  // Total observations
  const { count: totalObs } = await db
    .from('observations')
    .select('id', { count: 'exact', head: true })
    .eq('observer_id', userId)
    .eq('sync_status', 'synced')
    .gte('observed_at', yearStart)
    .lte('observed_at', yearEnd);

  // Observations with identifications for species/habitat/photo data
  const { data: obsData } = await db
    .from('observations')
    .select(`
      id, observed_at, habitat,
      photos:observation_photos(photo_url, is_primary),
      identifications(
        taxon_id, scientific_name, is_primary, is_research_grade,
        taxa(common_name_es, common_name_en, nom059_status, thumbnail_url)
      ),
      reactions:observation_reactions(count)
    `)
    .eq('observer_id', userId)
    .eq('sync_status', 'synced')
    .gte('observed_at', yearStart)
    .lte('observed_at', yearEnd)
    .order('observed_at', { ascending: true })
    .limit(5000);  // Cap for performance

  // Build species frequency map
  const speciesMap = new Map<string, {
    common_name_es: string | null;
    common_name_en: string | null;
    thumbnail_url: string | null;
    count: number;
  }>();

  // Habitat frequency map
  const habitatMap = new Map<string, number>();

  // Hour distribution
  const hourBuckets = new Array<number>(24).fill(0);

  // Top photo (most reactions or primary from research-grade)
  let topPhotoUrl: string | null = null;
  let topPhotoObsId: string | null = null;
  let topReactionCount = 0;

  // Dates
  let firstObsDate: string | null = null;
  let lastObsDate:  string | null = null;

  for (const obs of obsData ?? []) {
    // Dates
    if (!firstObsDate) firstObsDate = obs.observed_at as string;
    lastObsDate = obs.observed_at as string;

    // Hour
    const h = new Date(obs.observed_at as string).getUTCHours();
    hourBuckets[h]++;

    // Habitat
    if (obs.habitat) {
      habitatMap.set(obs.habitat as string, (habitatMap.get(obs.habitat as string) ?? 0) + 1);
    }

    // Primary identification
    const idents = (obs.identifications as unknown as Array<{
      scientific_name: string;
      is_primary: boolean;
      taxa: { common_name_es: string | null; common_name_en: string | null; thumbnail_url: string | null } | null;
    }>) ?? [];
    const primary = idents.find(i => i.is_primary);
    if (primary?.scientific_name) {
      const existing = speciesMap.get(primary.scientific_name) ?? {
        common_name_es: primary.taxa?.common_name_es ?? null,
        common_name_en: primary.taxa?.common_name_en ?? null,
        thumbnail_url:  primary.taxa?.thumbnail_url  ?? null,
        count: 0,
      };
      existing.count++;
      speciesMap.set(primary.scientific_name, existing);
    }

    // Top photo (most reactions)
    const reactions = (obs.reactions as unknown as Array<{ count: number }>) ?? [];
    const reactionCount = reactions.reduce((s, r) => s + r.count, 0);
    if (reactionCount > topReactionCount) {
      topReactionCount = reactionCount;
      topPhotoObsId = obs.id as string;
      const photos = (obs.photos as unknown as Array<{ photo_url: string; is_primary: boolean }>) ?? [];
      topPhotoUrl = photos.find(p => p.is_primary)?.photo_url ?? photos[0]?.photo_url ?? null;
    }
  }

  // Top 5 species
  const topSpecies = [...speciesMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([sci, v]) => ({ scientific_name: sci, ...v }));

  // Top 5 habitats
  const habitats = [...habitatMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([habitat, count]) => ({ habitat, count }));

  // Peak hour
  const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));

  // Streak (from user_streaks)
  const { data: streakData } = await db
    .from('user_streaks')
    .select('longest_days')
    .eq('user_id', userId)
    .maybeSingle<{ longest_days: number }>();
  const longestStreak = streakData?.longest_days ?? 0;

  // DwC export count (approximate: count export jobs that included this user's obs)
  const { count: dwcCount } = await db
    .from('export_jobs')
    .select('id', { count: 'exact', head: true })
    .contains('user_ids', [userId])
    .gte('created_at', yearStart)
    .lte('created_at', yearEnd)
    .limit(1000);

  // Threatened species (NOM-059 listed)
  const threatenedCount = [...speciesMap.keys()].filter(sci => {
    const obs2 = obsData?.find(o => {
      const idents2 = (o.identifications as unknown as Array<{ scientific_name: string; taxa: { nom059_status: string | null } | null }>) ?? [];
      return idents2.some(i => i.scientific_name === sci && i.taxa?.nom059_status);
    });
    return !!obs2;
  }).length;

  const payload: WrappedPayload = {
    year,
    total_observations: totalObs ?? 0,
    total_species: speciesMap.size,
    top_species: topSpecies,
    habitats,
    longest_streak_days: longestStreak,
    first_obs_date:   firstObsDate,
    last_obs_date:    lastObsDate,
    top_photo_url:    topPhotoUrl,
    top_photo_obs_id: topPhotoObsId,
    dwc_export_count: dwcCount ?? 0,
    threatened_species_count: threatenedCount,
    peak_hour: peakHour >= 0 ? peakHour : null,
    generated_at: new Date().toISOString(),
  };

  // -------------------------------------------------------------------------
  // Upsert cache
  // -------------------------------------------------------------------------
  await db
    .from('wrapped_cache')
    .upsert(
      { user_id: userId, year, payload, generated_at: payload.generated_at },
      { onConflict: 'user_id,year' },
    );

  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json', 'x-cache': 'MISS' },
  });
});
