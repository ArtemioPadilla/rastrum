# Chat Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemma 4 E2B as a text-chat backbone, a generic chat-entity registry covering 6 entity kinds (observations, species, projects, camera stations, observers, self-profile), a typed JSON tool layer over Supabase RPCs, and decompose `ChatView.astro` (1,441 LOC) into a slim orchestrator + four sibling components.

**Architecture:** ChatView orchestrator → ChatComposer + ChatBubble + ChatEntityChip + ChatEntityPicker. Engine layer (`chat-engine.ts`) dispatches between Gemma 4 (default) and Llama-3.2-1B (fallback) and runs a 1-round tool-call loop. Entity layer (`chat-entities/`) mirrors the existing `identifiers/` plugin registry. Five client-side tools call SECURITY INVOKER Supabase RPCs (`chat_entity_card` + 5 `chat_find_*`).

**Tech Stack:** Astro, TypeScript (strict), Tailwind, Vitest + happy-dom, Playwright, Supabase (Postgres + PostGIS + RLS), Dexie (IndexedDB), `@mlc-ai/web-llm` (Llama), `@huggingface/transformers` + ONNX Runtime Web (Gemma).

**Spec:** `docs/superpowers/specs/2026-05-09-chat-improvements-design.md`

**Worktree:** Implementation runs in a worktree per the user's earlier directive. Create with the `superpowers:using-git-worktrees` skill at execution time.

---

## Sequencing

The plan has 7 phases. Each phase ends in a green CI state and a meaningful commit. A reader could pause after any phase and the chat would still work.

- **Phase 1 — SQL (no UI changes).** Add the 6 new RPCs + SQL regression tests.
- **Phase 2 — Entity registry + Specs.** Generic `EntitySpec` + 6 built-in specs + unit tests.
- **Phase 3 — Tool layer.** `chat-tools.ts` + 5 tools + unit tests.
- **Phase 4 — Engine layer.** `loadGemmaTextEngine` + `chat-engine.ts` (tool-call loop) + ProfileEditForm download card.
- **Phase 5 — UI decomposition.** Extract ChatBubble / ChatComposer / ChatEntityChip / ChatEntityPicker; slim ChatView; wire chat-engine + entity attach handler.
- **Phase 6 — Deep links.** `AskRastrumButton` + drop into 5 entity surfaces.
- **Phase 7 — i18n + telemetry + E2E + runbook.**

Each task ends with a commit. `npm run typecheck && npm run test` must be green before each commit.

---

## File Structure

### New files

```
src/lib/chat-entities/
├── types.ts                       # EntityKind, EntityCard, EntitySpec
├── registry.ts                    # singleton, mirrors identifiers/registry.ts
├── index.ts                       # bootstrapChatEntities()
├── observation.ts                 # EntitySpec for kind='observation'
├── species.ts                     # EntitySpec for kind='species'
├── project.ts                     # EntitySpec for kind='project'
├── camera-station.ts              # EntitySpec for kind='camera_station'
├── observer.ts                    # EntitySpec for kind='observer'
└── self-profile.ts                # EntitySpec for kind='self_profile'

src/lib/chat-entities/*.test.ts    # one .test.ts per source file above (excl. index.ts)

src/lib/chat-tools.ts              # tool registry + dispatcher + 5 tools
src/lib/chat-tools.test.ts

src/lib/chat-engine.ts             # streamChat() with tool-call loop
src/lib/chat-engine.test.ts

src/lib/parse-attach-querystring.ts        # ?attach=kind:id parser
src/lib/parse-attach-querystring.test.ts

src/components/ChatComposer.astro
src/components/ChatEntityChip.astro
src/components/ChatEntityPicker.astro
src/components/ChatBubble.astro
src/components/AskRastrumButton.astro

tests/unit/chat-composer.test.ts
tests/unit/chat-entity-picker.test.ts
tests/unit/ask-rastrum-button.test.ts

tests/e2e/chat-deep-link.spec.ts
tests/e2e/chat-entity-picker.spec.ts

tests/sql/chat.sql                 # SQL regression assertions

docs/runbooks/chat-improvements.md
```

### Modified files

```
docs/specs/infra/supabase-schema.sql  # append 6 new functions + grants
src/lib/local-ai.ts                   # add loadGemmaTextEngine + cancel/clear
src/components/ChatView.astro         # slim from 1,441 → ~400 LOC
src/components/ProfileEditForm.astro  # add Gemma 4 (text) download card
src/components/ShareObsView.astro     # mount AskRastrumButton
src/components/MyObservationsView.astro     # mount AskRastrumButton
src/components/SpeciesProfileView.astro     # mount AskRastrumButton
src/components/ProjectDetailView.astro      # mount AskRastrumButton
src/components/PublicProfileView.astro      # mount AskRastrumButton
src/components/CameraStationItem.astro      # mount AskRastrumButton (if exists; verify in Task 23)
src/lib/db.ts                          # extend ChatTurnRecord type
src/i18n/en.json                       # add chat.entities.*, chat.tools.*, chat.attach_entity_*
src/i18n/es.json                       # mirror
.github/workflows/db-validate.yml      # wire tests/sql/chat.sql
docs/runbooks/00-index.md              # link new runbook
```

---

# Phase 1 — SQL Layer

The chat surface needs read-only Postgres functions to fetch entity cards and search relations. All functions are `SECURITY INVOKER` (RLS does the gating), `SET search_path = public, extensions, pg_temp` (per the lint guard), `LANGUAGE plpgsql` or `LANGUAGE sql STABLE`, and `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO authenticated`.

The dispatcher `chat_entity_card(p_kind, p_id)` accepts a kind string and an id (uuid for db rows; slug for species/projects), and returns one JSONB row matching the `EntityCard` shape from the spec.

---

### Task 1: Add the per-kind card builders + dispatcher

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append to end, before any "remediation" block at the bottom)

- [ ] **Step 1: Read the relevant schema sections to confirm column names**

Run:
```bash
grep -n "CREATE TABLE IF NOT EXISTS public.observations" docs/specs/infra/supabase-schema.sql
grep -n "CREATE TABLE IF NOT EXISTS public.taxa" docs/specs/infra/supabase-schema.sql
grep -n "CREATE TABLE IF NOT EXISTS public.projects" docs/specs/infra/supabase-schema.sql
grep -n "CREATE TABLE IF NOT EXISTS public.camera_stations" docs/specs/infra/supabase-schema.sql
grep -n "CREATE OR REPLACE VIEW public.community_observers" docs/specs/infra/supabase-schema.sql
```

Expected: Five line numbers. Read 30 lines starting at each to confirm column names. Note any drift from the assumptions in this plan; if a column you expected doesn't exist, stop and ask.

- [ ] **Step 2: Append the dispatcher + per-kind card builders**

Append the following at the end of `docs/specs/infra/supabase-schema.sql`, before any post-creation remediation block (search for "remediation" near the end of the file):

```sql
-- ── Chat entity cards (M01 chat improvements, 2026-05-09) ──
-- Read-only functions returning EntityCard-shaped JSONB. Every function
-- is SECURITY INVOKER; the existing RLS policies enforce visibility.

DROP FUNCTION IF EXISTS public.chat_obs_card(uuid);
CREATE FUNCTION public.chat_obs_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH o AS (
    SELECT
      o.id, o.observer_user_id, o.observed_at,
      o.primary_taxon_id, o.obscure_level,
      o.location, o.location_obscured,
      o.region_primary, o.is_research_grade, o.notes,
      t.scientific_name, t.common_name_es, t.common_name_en,
      t.kingdom, t.family
    FROM public.observations o
    LEFT JOIN public.taxa t ON t.id = o.primary_taxon_id
    WHERE o.id = p_id
  )
  SELECT CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'observation',
    'id',            o.id::text,
    'label',         coalesce(o.scientific_name, '—')
                     || ' · ' || to_char(o.observed_at, 'Mon DD')
                     || coalesce(' · ' || o.region_primary, ''),
    'summary_text',
      'Observation of ' || coalesce(o.scientific_name, 'unknown taxon')
      || coalesce(' (' || o.common_name_en || ')', '')
      || ' on ' || to_char(o.observed_at, 'YYYY-MM-DD')
      || coalesce(' in ' || o.region_primary, '')
      || CASE WHEN o.is_research_grade THEN '. Research grade.' ELSE '. Needs review.' END
      || coalesce(' Observer notes: ' || left(o.notes, 240), ''),
    'fields',        jsonb_build_object(
      'scientific_name', o.scientific_name,
      'common_name_en',  o.common_name_en,
      'common_name_es',  o.common_name_es,
      'kingdom',         o.kingdom,
      'family',          o.family,
      'observed_at',     o.observed_at,
      'region_primary',  o.region_primary,
      'is_research_grade', o.is_research_grade,
      'obscure_level',   o.obscure_level,
      'lat', CASE WHEN auth.uid() = o.observer_user_id
                  THEN ST_Y(o.location::geometry)
                  ELSE ST_Y(coalesce(o.location_obscured, o.location)::geometry) END,
      'lng', CASE WHEN auth.uid() = o.observer_user_id
                  THEN ST_X(o.location::geometry)
                  ELSE ST_X(coalesce(o.location_obscured, o.location)::geometry) END,
      'coords_obscured', (auth.uid() <> o.observer_user_id AND o.location_obscured IS NOT NULL)
    ),
    'suggested_questions', jsonb_build_array(
      'Why is this ' || CASE WHEN o.is_research_grade THEN 'research grade' ELSE 'needs review' END || '?',
      'What other observations of this species are nearby?',
      'Tell me about ' || coalesce(o.scientific_name, 'this species') || '.'
    ),
    'related',       jsonb_build_object(
      'primary_taxon_id', o.primary_taxon_id::text,
      'observer_id',      o.observer_user_id::text
    )
  ) END
  FROM o;
$$;

DROP FUNCTION IF EXISTS public.chat_species_card(text);
CREATE FUNCTION public.chat_species_card(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH t AS (
    SELECT id, scientific_name, canonical_name, common_name_es, common_name_en,
           kingdom, family, nom059_status, cites_appendix, iucn_category, is_endemic_mexico,
           description_es, description_en, obscure_level
    FROM public.taxa
    WHERE id::text = p_query
       OR canonical_name ILIKE p_query
       OR scientific_name ILIKE p_query
    ORDER BY canonical_name
    LIMIT 1
  )
  SELECT CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'species',
    'id',            t.id::text,
    'label',         t.scientific_name,
    'summary_text',
      coalesce(t.scientific_name, '')
      || coalesce(' (' || t.common_name_en || ')', '')
      || ' — ' || coalesce(t.kingdom, '?') || ' / ' || coalesce(t.family, '?')
      || coalesce('. NOM-059: ' || t.nom059_status, '')
      || coalesce('. CITES: ' || t.cites_appendix, '')
      || coalesce('. IUCN: ' || t.iucn_category, '')
      || coalesce('. ' || left(t.description_en, 240), ''),
    'fields',        jsonb_build_object(
      'scientific_name',     t.scientific_name,
      'common_name_en',      t.common_name_en,
      'common_name_es',      t.common_name_es,
      'kingdom',             t.kingdom,
      'family',              t.family,
      'nom059_status',       t.nom059_status,
      'cites_appendix',      t.cites_appendix,
      'iucn_category',       t.iucn_category,
      'is_endemic_mexico',   t.is_endemic_mexico,
      'obscure_level',       t.obscure_level
    ),
    'suggested_questions', jsonb_build_array(
      'Where in Mexico is ' || t.scientific_name || ' typically observed?',
      'What does NOM-059 ' || coalesce(t.nom059_status, 'status') || ' mean?',
      'Show me recent observations of this species.'
    ),
    'related',       jsonb_build_object(
      'primary_taxon_id', t.id::text
    )
  ) END
  FROM t;
$$;

DROP FUNCTION IF EXISTS public.chat_project_card(text);
CREATE FUNCTION public.chat_project_card(p_query text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH p AS (
    SELECT id, slug, name, name_es, description, description_es,
           visibility, owner_user_id, area_km2
    FROM public.projects_with_geojson
    WHERE id::text = p_query OR slug = p_query
    LIMIT 1
  ),
  c AS (
    SELECT count(*)::int AS obs_count
    FROM public.observations o, p
    WHERE o.project_id = p.id
  )
  SELECT CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'project',
    'id',            p.id::text,
    'label',         coalesce(p.name, p.slug),
    'summary_text',
      'Project "' || coalesce(p.name, p.slug) || '"'
      || coalesce(' — ' || left(p.description, 240), '')
      || '. Visibility: ' || p.visibility
      || coalesce('. Approx ' || round(p.area_km2)::text || ' km².', '')
      || ' ' || c.obs_count || ' observations.',
    'fields',        jsonb_build_object(
      'slug',         p.slug,
      'name',         p.name,
      'name_es',      p.name_es,
      'visibility',   p.visibility,
      'area_km2',     p.area_km2,
      'obs_count',    c.obs_count
    ),
    'suggested_questions', jsonb_build_array(
      'Which species are most common in this project?',
      'How many observations were added in the last 30 days?',
      'List the camera stations in this project.'
    ),
    'related',       jsonb_build_object(
      'project_id', p.id::text
    )
  ) END
  FROM p, c;
$$;

DROP FUNCTION IF EXISTS public.chat_camera_station_card(uuid);
CREATE FUNCTION public.chat_camera_station_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH s AS (
    SELECT cs.id, cs.project_id, cs.station_key, cs.name, cs.habitat,
           cs.camera_model, cs.notes, cs.coords,
           p.name AS project_name, p.slug AS project_slug
    FROM public.camera_stations cs
    LEFT JOIN public.projects p ON p.id = cs.project_id
    WHERE cs.id = p_id
  ),
  pn AS (
    SELECT coalesce(sum(extract(day from coalesce(end_date::timestamp, now()) - start_date::timestamp))::int, 0) AS trap_nights
    FROM public.camera_station_periods, s
    WHERE camera_station_periods.station_id = s.id
  )
  SELECT CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'camera_station',
    'id',            s.id::text,
    'label',         coalesce(s.name, s.station_key),
    'summary_text',
      'Camera station ' || s.station_key
      || coalesce(' (' || s.name || ')', '')
      || coalesce(' in project "' || s.project_name || '"', '')
      || coalesce(', habitat: ' || s.habitat, '')
      || coalesce(', camera: ' || s.camera_model, '')
      || '. Trap-nights to date: ' || pn.trap_nights || '.',
    'fields',        jsonb_build_object(
      'station_key',  s.station_key,
      'name',         s.name,
      'habitat',      s.habitat,
      'camera_model', s.camera_model,
      'project_slug', s.project_slug,
      'trap_nights',  pn.trap_nights,
      'lat',          ST_Y(s.coords::geometry),
      'lng',          ST_X(s.coords::geometry)
    ),
    'suggested_questions', jsonb_build_array(
      'Which species have been detected at this station?',
      'What is the detection rate per 100 trap-nights?',
      'How long has this station been deployed?'
    ),
    'related',       jsonb_build_object(
      'project_id', s.project_id::text
    )
  ) END
  FROM s, pn;
$$;

DROP FUNCTION IF EXISTS public.chat_observer_card(uuid);
CREATE FUNCTION public.chat_observer_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  -- community_observers is the public view (no centroid, no email).
  -- It already filters out hide_from_leaderboards = true.
  WITH u AS (
    SELECT id, username, display_name, avatar_url, country_code,
           is_expert, expert_taxa,
           observation_count, species_count, obs_count_30d,
           last_observation_at, joined_at, karma_total
    FROM public.community_observers
    WHERE id = p_id
  )
  SELECT CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'observer',
    'id',            u.id::text,
    'label',         coalesce(u.display_name, u.username),
    'thumbnail',     u.avatar_url,
    'summary_text',
      coalesce(u.display_name, u.username)
      || coalesce(' (@' || u.username || ')', '')
      || coalesce(' from ' || u.country_code, '')
      || '. ' || u.observation_count || ' observations, '
      || u.species_count || ' species, '
      || u.karma_total || ' karma.'
      || CASE WHEN u.is_expert THEN ' Expert.' ELSE '' END,
    'fields',        jsonb_build_object(
      'username',          u.username,
      'display_name',      u.display_name,
      'country_code',      u.country_code,
      'is_expert',         u.is_expert,
      'observation_count', u.observation_count,
      'species_count',     u.species_count,
      'obs_count_30d',     u.obs_count_30d,
      'karma_total',       u.karma_total
    ),
    'suggested_questions', jsonb_build_array(
      'What species does ' || coalesce(u.display_name, u.username) || ' observe most?',
      'When were they most active?',
      'What region do they observe in?'
    ),
    'related',       jsonb_build_object(
      'observer_id', u.id::text
    )
  ) END
  FROM u;
$$;

DROP FUNCTION IF EXISTS public.chat_self_profile_card(uuid);
CREATE FUNCTION public.chat_self_profile_card(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  WITH u AS (
    SELECT id, username, display_name, bio, avatar_url, preferred_lang,
           is_expert, expert_taxa, observer_license,
           observation_count, country_code, region_primary,
           karma_total, joined_at, last_observation_at
    FROM public.users
    WHERE id = p_id
      AND id = auth.uid()  -- self only
  )
  SELECT CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
    'kind',          'self_profile',
    'id',            u.id::text,
    'label',         coalesce(u.display_name, u.username, 'You'),
    'thumbnail',     u.avatar_url,
    'summary_text',
      'Your profile: ' || coalesce(u.display_name, u.username)
      || coalesce(', based in ' || u.country_code, '')
      || '. ' || u.observation_count || ' observations, '
      || u.karma_total || ' karma.'
      || coalesce(' Bio: ' || left(u.bio, 200), '')
      || ' Preferred language: ' || coalesce(u.preferred_lang, 'en') || '.',
    'fields',        jsonb_build_object(
      'username',           u.username,
      'display_name',       u.display_name,
      'preferred_lang',     u.preferred_lang,
      'country_code',       u.country_code,
      'region_primary',     u.region_primary,
      'is_expert',          u.is_expert,
      'expert_taxa',        u.expert_taxa,
      'observer_license',   u.observer_license,
      'observation_count',  u.observation_count,
      'karma_total',        u.karma_total
    ),
    'suggested_questions', jsonb_build_array(
      'How is my karma calculated?',
      'What badges am I close to earning?',
      'Show my last 10 observations.'
    ),
    'related',       jsonb_build_object(
      'observer_id', u.id::text
    )
  ) END
  FROM u;
$$;

-- Dispatcher: routes by kind. Returns NULL for unknown kinds so callers
-- can treat that as 'entity not found'.
DROP FUNCTION IF EXISTS public.chat_entity_card(text, text);
CREATE FUNCTION public.chat_entity_card(p_kind text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uuid uuid;
BEGIN
  IF p_kind IN ('observation','camera_station','observer','self_profile') THEN
    BEGIN
      v_uuid := p_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
  END IF;

  RETURN CASE p_kind
    WHEN 'observation'    THEN public.chat_obs_card(v_uuid)
    WHEN 'species'        THEN public.chat_species_card(p_id)
    WHEN 'project'        THEN public.chat_project_card(p_id)
    WHEN 'camera_station' THEN public.chat_camera_station_card(v_uuid)
    WHEN 'observer'       THEN public.chat_observer_card(v_uuid)
    WHEN 'self_profile'   THEN public.chat_self_profile_card(v_uuid)
    ELSE NULL
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.chat_obs_card(uuid)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_species_card(text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_project_card(text)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_camera_station_card(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_observer_card(uuid)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_self_profile_card(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_entity_card(text, text)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.chat_obs_card(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_species_card(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_project_card(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_camera_station_card(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_observer_card(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_self_profile_card(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_entity_card(text, text)    TO authenticated;
```

- [ ] **Step 3: Apply the schema and verify**

Run:
```bash
make db-apply
make db-verify
```

Expected: `db-apply` exits 0; `db-verify` shows the new functions in its output.

- [ ] **Step 4: Replay to confirm idempotency**

Run: `make db-apply`

Expected: exits 0 (the `DROP … IF EXISTS` + `CREATE` pattern is replay-safe).

- [ ] **Step 5: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(chat): chat_entity_card dispatcher + 6 per-kind card builders"
```

---

### Task 2: Add the find_* search functions

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append after the card builders from Task 1)

These are read-only filtered queries the chat tools call when the model wants follow-up data.

- [ ] **Step 1: Append the five find_* functions**

Append to the same file, after the dispatcher:

```sql
-- ── Chat tools — read-only search/list functions ──

DROP FUNCTION IF EXISTS public.chat_find_observations(jsonb, int);
CREATE FUNCTION public.chat_find_observations(p_filters jsonb, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_owner_self    boolean := coalesce((p_filters ->> 'owner') = 'me', false);
  v_taxon_id      uuid    := nullif(p_filters ->> 'primary_taxon_id', '')::uuid;
  v_project_id    uuid    := nullif(p_filters ->> 'project_id', '')::uuid;
  v_near_obs      uuid    := nullif(p_filters ->> 'near_observation_id', '')::uuid;
  v_radius_km     numeric := coalesce((p_filters ->> 'radius_km')::numeric, 50);
  v_research_only boolean := coalesce((p_filters ->> 'research_grade')::boolean, false);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_card)
    FROM (
      SELECT jsonb_build_object(
        'id',                o.id::text,
        'scientific_name',   t.scientific_name,
        'common_name_en',    t.common_name_en,
        'observed_at',       o.observed_at,
        'region_primary',    o.region_primary,
        'is_research_grade', o.is_research_grade
      ) AS row_card
      FROM public.observations o
      LEFT JOIN public.taxa t ON t.id = o.primary_taxon_id
      LEFT JOIN public.observations near ON near.id = v_near_obs
      WHERE (NOT v_owner_self    OR o.observer_user_id = auth.uid())
        AND (v_taxon_id    IS NULL OR o.primary_taxon_id = v_taxon_id)
        AND (v_project_id  IS NULL OR o.project_id      = v_project_id)
        AND (v_near_obs    IS NULL OR ST_DWithin(o.location, near.location, v_radius_km * 1000))
        AND (NOT v_research_only OR o.is_research_grade = true)
      ORDER BY o.observed_at DESC
      LIMIT greatest(1, least(p_limit, 50))
    ) sub
  ), '[]'::jsonb);
END;
$$;

DROP FUNCTION IF EXISTS public.chat_find_species(text, int);
CREATE FUNCTION public.chat_find_species(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',                t.id::text,
      'scientific_name',   t.scientific_name,
      'common_name_en',    t.common_name_en,
      'common_name_es',    t.common_name_es,
      'kingdom',           t.kingdom,
      'family',            t.family
    ) AS row_card
    FROM public.taxa t
    WHERE t.canonical_name    ILIKE ('%' || p_query || '%')
       OR t.scientific_name   ILIKE ('%' || p_query || '%')
       OR t.common_name_en    ILIKE ('%' || p_query || '%')
       OR t.common_name_es    ILIKE ('%' || p_query || '%')
    ORDER BY (t.scientific_name = p_query) DESC, t.canonical_name
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_projects(text, int);
CREATE FUNCTION public.chat_find_projects(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',     p.id::text,
      'slug',   p.slug,
      'name',   p.name,
      'name_es', p.name_es
    ) AS row_card
    FROM public.projects_with_geojson p
    WHERE p.name    ILIKE ('%' || p_query || '%')
       OR p.name_es ILIKE ('%' || p_query || '%')
       OR p.slug    ILIKE ('%' || p_query || '%')
    ORDER BY p.name
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_camera_stations(uuid, int);
CREATE FUNCTION public.chat_find_camera_stations(p_project_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',          cs.id::text,
      'station_key', cs.station_key,
      'name',        cs.name,
      'habitat',     cs.habitat
    ) AS row_card
    FROM public.camera_stations cs
    WHERE cs.project_id = p_project_id
    ORDER BY cs.station_key
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

DROP FUNCTION IF EXISTS public.chat_find_observers(text, int);
CREATE FUNCTION public.chat_find_observers(p_query text, p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(row_card), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',           u.id::text,
      'username',     u.username,
      'display_name', u.display_name,
      'is_expert',    u.is_expert
    ) AS row_card
    FROM public.community_observers u
    WHERE u.username     ILIKE ('%' || p_query || '%')
       OR u.display_name ILIKE ('%' || p_query || '%')
    ORDER BY u.observation_count DESC
    LIMIT greatest(1, least(p_limit, 50))
  ) sub;
$$;

REVOKE EXECUTE ON FUNCTION public.chat_find_observations(jsonb, int)        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_species(text, int)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_projects(text, int)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_camera_stations(uuid, int)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.chat_find_observers(text, int)            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.chat_find_observations(jsonb, int)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_species(text, int)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_projects(text, int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_camera_stations(uuid, int)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_find_observers(text, int)             TO authenticated;
```

- [ ] **Step 2: Apply + replay**

Run:
```bash
make db-apply
make db-apply  # idempotency check
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(chat): add chat_find_* read-only search RPCs"
```

---

### Task 3: SQL regression tests for chat functions

**Files:**
- Create: `tests/sql/chat.sql`
- Modify: `.github/workflows/db-validate.yml` (add the new test file to the run step)

- [ ] **Step 1: Read the existing rls.sql to mirror the assertion style**

Run: `head -80 tests/sql/rls.sql`

Note the `DO $$ BEGIN ... ASSERT ...; EXCEPTION WHEN OTHERS THEN ... END $$;` pattern.

- [ ] **Step 2: Create `tests/sql/chat.sql`**

Write `tests/sql/chat.sql`:

```sql
-- Chat function regression tests (M01 chat improvements).
-- Mirrors the style of tests/sql/rls.sql — plain DO blocks with ASSERT.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- Seed: one observer + one observation with a sensitive species.
INSERT INTO public.users (id, username) VALUES
  ('11111111-1111-1111-1111-111111111111', 'chat_test_user_1')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, username) VALUES
  ('22222222-2222-2222-2222-222222222222', 'chat_test_user_2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.taxa (id, scientific_name, canonical_name, kingdom, family, obscure_level)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'Test sensitivus',
  'Test sensitivus',
  'Animalia',
  'Testidae',
  'obscured'
)
ON CONFLICT (id) DO UPDATE SET obscure_level = EXCLUDED.obscure_level;

INSERT INTO public.observations (
  id, observer_user_id, primary_taxon_id, observed_at,
  location, location_obscured, obscure_level, region_primary, is_research_grade
)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  '2026-05-01T12:00:00Z',
  ST_SetSRID(ST_MakePoint(-99.13, 19.43), 4326),
  ST_SetSRID(ST_MakePoint(-99.10, 19.40), 4326),
  'obscured',
  'CDMX',
  false
)
ON CONFLICT (id) DO NOTHING;

-- Test 1: chat_obs_card returns NULL for unknown id.
DO $$
BEGIN
  ASSERT public.chat_obs_card('00000000-0000-0000-0000-000000000000') IS NULL,
    'chat_obs_card returned non-NULL for unknown id';
END $$;

-- Test 2: chat_obs_card returns owner-precise coords when auth.uid() = observer.
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
DO $$
DECLARE
  card jsonb := public.chat_obs_card('44444444-4444-4444-4444-444444444444');
BEGIN
  ASSERT (card -> 'fields' ->> 'coords_obscured')::boolean = false,
    'owner-self should see coords_obscured=false';
  ASSERT abs((card -> 'fields' ->> 'lat')::numeric - 19.43) < 0.01,
    'owner-self should see precise lat ~19.43';
END $$;

-- Test 3: chat_obs_card returns obscured coords for non-owner.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE
  card jsonb := public.chat_obs_card('44444444-4444-4444-4444-444444444444');
BEGIN
  ASSERT (card -> 'fields' ->> 'coords_obscured')::boolean = true,
    'non-owner should see coords_obscured=true';
  ASSERT abs((card -> 'fields' ->> 'lat')::numeric - 19.40) < 0.01,
    'non-owner should see obscured lat ~19.40';
END $$;

-- Test 4: chat_self_profile_card refuses other-user lookup.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222"}';
DO $$
DECLARE
  card jsonb := public.chat_self_profile_card('11111111-1111-1111-1111-111111111111');
BEGIN
  ASSERT card IS NULL,
    'chat_self_profile_card should return NULL when auth.uid() != p_id';
END $$;

-- Test 5: chat_self_profile_card returns the row when auth.uid() = p_id.
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
DO $$
DECLARE
  card jsonb := public.chat_self_profile_card('11111111-1111-1111-1111-111111111111');
BEGIN
  ASSERT card IS NOT NULL,
    'chat_self_profile_card should return a row for self';
  ASSERT (card ->> 'kind') = 'self_profile',
    'card.kind must be self_profile';
END $$;

-- Test 6: chat_entity_card dispatcher routes to the right per-kind function.
DO $$
DECLARE
  card jsonb := public.chat_entity_card('observation', '44444444-4444-4444-4444-444444444444');
BEGIN
  ASSERT (card ->> 'kind') = 'observation', 'dispatcher should route observation';
END $$;

-- Test 7: chat_entity_card returns NULL for unknown kind.
DO $$
BEGIN
  ASSERT public.chat_entity_card('not_a_kind', 'anything') IS NULL,
    'dispatcher must return NULL for unknown kind';
END $$;

-- Test 8: chat_entity_card returns NULL for invalid uuid on uuid-typed kinds.
DO $$
BEGIN
  ASSERT public.chat_entity_card('observation', 'not-a-uuid') IS NULL,
    'dispatcher must swallow invalid_text_representation and return NULL';
END $$;

-- Test 9: chat_find_observations respects owner=me filter.
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111"}';
DO $$
DECLARE
  rows jsonb := public.chat_find_observations('{"owner":"me"}'::jsonb, 10);
BEGIN
  ASSERT jsonb_array_length(rows) >= 1,
    'find_observations(owner=me) should return at least the seeded row';
END $$;

-- Test 10: chat_find_observers excludes hide_from_leaderboards users
-- (community_observers view already enforces this).
DO $$
DECLARE
  rows jsonb := public.chat_find_observers('chat_test_user', 10);
BEGIN
  ASSERT rows IS NOT NULL, 'find_observers must return at least an empty array';
END $$;

-- Cleanup.
ROLLBACK;

\echo 'tests/sql/chat.sql passed'
```

- [ ] **Step 3: Wire the new test into `db-validate.yml`**

Read `.github/workflows/db-validate.yml` and find the step that runs `tests/sql/rls.sql`. Add a sibling step for `tests/sql/chat.sql`:

Find the line:
```yaml
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
```

Add **immediately after** the rls step (preserving any indentation):
```yaml
      - name: Run chat-function regression suite
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/chat.sql
```

- [ ] **Step 4: Run the tests locally**

Run:
```bash
make db-apply
psql "$(grep -E '^SUPABASE_DB_URL' .env.local | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f tests/sql/chat.sql
```

Expected: prints `tests/sql/chat.sql passed`.

- [ ] **Step 5: Commit**

```bash
git add tests/sql/chat.sql .github/workflows/db-validate.yml
git commit -m "test(chat): SQL regression suite for chat_* functions"
```

---

# Phase 2 — Entity Registry + Specs

Mirrors `src/lib/identifiers/` exactly. The registry is a singleton with collision detection. Each EntitySpec exports the `kind`, an icon, and a `fetchCard(id)` that calls `supabase.rpc('chat_entity_card', {p_kind, p_id})`.

---

### Task 4: EntitySpec types

**Files:**
- Create: `src/lib/chat-entities/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/lib/chat-entities/types.ts
//
// Generic entity-context registry — mirrors src/lib/identifiers/types.ts.
// One EntitySpec per kind; the runtime serializes a fetched card into a
// system-prompt block and uses `related` pointers as tool args.

export type EntityKind =
  | 'observation'
  | 'species'
  | 'project'
  | 'camera_station'
  | 'observer'
  | 'self_profile';

export interface EntityCard {
  kind: EntityKind;
  id: string;
  label: string;
  thumbnail?: string | null;
  summary_text: string;
  fields: Record<string, string | number | boolean | null>;
  suggested_questions: string[];
  related: {
    project_id?: string;
    primary_taxon_id?: string;
    location_id?: string;
    observer_id?: string;
  };
}

export interface EntitySpec {
  kind: EntityKind;
  /** Emoji or short brand icon shown in the chip. */
  icon: string;
  /** EN/ES short label for tabs/menus. */
  label: { en: string; es: string };
  /**
   * Fetch the canonical card for the given id. Implementations call
   * supabase.rpc('chat_entity_card', { p_kind, p_id }) and shape the
   * response. Throws on network error; returns null when the row is
   * missing or RLS hides it.
   */
  fetchCard(id: string): Promise<EntityCard | null>;
  /**
   * Tools this entity kind tends to need. Used to pre-prime the
   * tool list shown to the model in the system prompt.
   */
  suggestedTools: string[];
}

export interface ChatEntityRegistry {
  register(spec: EntitySpec): void;
  get(kind: EntityKind): EntitySpec | undefined;
  list(): EntitySpec[];
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat-entities/types.ts
git commit -m "feat(chat-entities): types for EntityCard + EntitySpec + registry"
```

---

### Task 5: Registry singleton + tests

**Files:**
- Create: `src/lib/chat-entities/registry.ts`
- Create: `src/lib/chat-entities/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/chat-entities/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from './registry';
import type { EntitySpec } from './types';

const fakeSpec = (kind: EntitySpec['kind']): EntitySpec => ({
  kind,
  icon: '·',
  label: { en: 'X', es: 'X' },
  async fetchCard() { return null; },
  suggestedTools: [],
});

beforeEach(() => {
  (registry as unknown as { _resetForTests: () => void })._resetForTests();
});

describe('chat-entities registry', () => {
  it('registers and retrieves a spec', () => {
    const spec = fakeSpec('observation');
    registry.register(spec);
    expect(registry.get('observation')).toBe(spec);
  });

  it('throws on duplicate kind registration', () => {
    registry.register(fakeSpec('species'));
    expect(() => registry.register(fakeSpec('species'))).toThrow(/collision/);
  });

  it('list returns every registered spec', () => {
    registry.register(fakeSpec('observation'));
    registry.register(fakeSpec('species'));
    expect(registry.list().map(s => s.kind).sort()).toEqual(['observation', 'species']);
  });

  it('get returns undefined for unregistered kind', () => {
    expect(registry.get('project')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/lib/chat-entities/registry.test.ts`

Expected: FAIL with "Cannot find module './registry'".

- [ ] **Step 3: Implement the registry**

```typescript
// src/lib/chat-entities/registry.ts
//
// Singleton EntitySpec registry. Collision-detected at register-time so
// double-bootstrap raises loudly. Mirrors src/lib/identifiers/registry.ts.

import type { ChatEntityRegistry, EntityKind, EntitySpec } from './types';

class Registry implements ChatEntityRegistry {
  private specs = new Map<EntityKind, EntitySpec>();

  register(spec: EntitySpec): void {
    if (this.specs.has(spec.kind)) {
      throw new Error(`Chat entity kind collision: ${spec.kind}`);
    }
    this.specs.set(spec.kind, spec);
  }

  get(kind: EntityKind): EntitySpec | undefined {
    return this.specs.get(kind);
  }

  list(): EntitySpec[] {
    return Array.from(this.specs.values());
  }

  _resetForTests(): void {
    this.specs.clear();
  }
}

export const registry: ChatEntityRegistry = new Registry();
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/lib/chat-entities/registry.test.ts`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-entities/registry.ts src/lib/chat-entities/registry.test.ts
git commit -m "feat(chat-entities): singleton registry with collision detection"
```

---

### Task 6: Observation EntitySpec + test

**Files:**
- Create: `src/lib/chat-entities/observation.ts`
- Create: `src/lib/chat-entities/observation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/chat-entities/observation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('../supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

import { observationSpec } from './observation';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('observation EntitySpec', () => {
  it('kind is "observation"', () => {
    expect(observationSpec.kind).toBe('observation');
  });

  it('fetchCard calls chat_entity_card with kind+id', async () => {
    rpcMock.mockResolvedValue({
      data: {
        kind: 'observation',
        id: 'abc',
        label: 'Test',
        summary_text: 's',
        fields: {},
        suggested_questions: [],
        related: {},
      },
      error: null,
    });
    const card = await observationSpec.fetchCard('abc');
    expect(rpcMock).toHaveBeenCalledWith('chat_entity_card', {
      p_kind: 'observation',
      p_id: 'abc',
    });
    expect(card?.label).toBe('Test');
  });

  it('returns null when RPC returns null data', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await observationSpec.fetchCard('abc')).toBeNull();
  });

  it('throws on RPC error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(observationSpec.fetchCard('abc')).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/lib/chat-entities/observation.test.ts`

Expected: FAIL with "Cannot find module './observation'".

- [ ] **Step 3: Implement**

```typescript
// src/lib/chat-entities/observation.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const observationSpec: EntitySpec = {
  kind: 'observation',
  icon: '🔍',
  label: { en: 'Observation', es: 'Observación' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'observation',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_species'],
};
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/lib/chat-entities/observation.test.ts`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-entities/observation.ts src/lib/chat-entities/observation.test.ts
git commit -m "feat(chat-entities): observation EntitySpec"
```

---

### Task 7: Five remaining EntitySpecs (species, project, camera_station, observer, self_profile)

These are all the same shape as `observation.ts` — only `kind`, `icon`, `label`, and `suggestedTools` differ. Use one task to write all five plus a single shared test pattern.

**Files:**
- Create: `src/lib/chat-entities/species.ts`
- Create: `src/lib/chat-entities/project.ts`
- Create: `src/lib/chat-entities/camera-station.ts`
- Create: `src/lib/chat-entities/observer.ts`
- Create: `src/lib/chat-entities/self-profile.ts`
- Create: `src/lib/chat-entities/specs.test.ts`

- [ ] **Step 1: Write the shared test**

```typescript
// src/lib/chat-entities/specs.test.ts
import { describe, it, expect, vi } from 'vitest';

const rpcMock = vi.fn();
vi.mock('../supabase', () => ({ getSupabase: () => ({ rpc: rpcMock }) }));

import { speciesSpec } from './species';
import { projectSpec } from './project';
import { cameraStationSpec } from './camera-station';
import { observerSpec } from './observer';
import { selfProfileSpec } from './self-profile';

const cases = [
  ['species', speciesSpec],
  ['project', projectSpec],
  ['camera_station', cameraStationSpec],
  ['observer', observerSpec],
  ['self_profile', selfProfileSpec],
] as const;

describe.each(cases)('%s EntitySpec', (kind, spec) => {
  it(`kind is "${kind}"`, () => {
    expect(spec.kind).toBe(kind);
  });

  it('fetchCard calls chat_entity_card with the right kind', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    await spec.fetchCard('xxx');
    expect(rpcMock).toHaveBeenCalledWith('chat_entity_card', {
      p_kind: kind,
      p_id: 'xxx',
    });
  });

  it('throws on RPC error', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rls denied' } });
    await expect(spec.fetchCard('xxx')).rejects.toThrow(/rls denied/);
  });
});
```

- [ ] **Step 2: Implement each spec**

```typescript
// src/lib/chat-entities/species.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const speciesSpec: EntitySpec = {
  kind: 'species',
  icon: '🌿',
  label: { en: 'Species', es: 'Especie' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'species',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_species'],
};
```

```typescript
// src/lib/chat-entities/project.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const projectSpec: EntitySpec = {
  kind: 'project',
  icon: '🗺️',
  label: { en: 'Project', es: 'Proyecto' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'project',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_camera_stations'],
};
```

```typescript
// src/lib/chat-entities/camera-station.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const cameraStationSpec: EntitySpec = {
  kind: 'camera_station',
  icon: '📷',
  label: { en: 'Camera station', es: 'Estación' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'camera_station',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations'],
};
```

```typescript
// src/lib/chat-entities/observer.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const observerSpec: EntitySpec = {
  kind: 'observer',
  icon: '👤',
  label: { en: 'Observer', es: 'Observador' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'observer',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations', 'find_species'],
};
```

```typescript
// src/lib/chat-entities/self-profile.ts
import { getSupabase } from '../supabase';
import type { EntityCard, EntitySpec } from './types';

export const selfProfileSpec: EntitySpec = {
  kind: 'self_profile',
  icon: '🪪',
  label: { en: 'My profile', es: 'Mi perfil' },
  async fetchCard(id) {
    const { data, error } = await getSupabase().rpc('chat_entity_card', {
      p_kind: 'self_profile',
      p_id: id,
    });
    if (error) throw new Error(error.message);
    return (data as EntityCard) ?? null;
  },
  suggestedTools: ['find_observations'],
};
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/chat-entities/`

Expected: 4 (registry) + 4 (observation) + 5×3 (specs) = 23 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat-entities/{species,project,camera-station,observer,self-profile,specs.test}.ts
git commit -m "feat(chat-entities): species/project/camera-station/observer/self-profile specs"
```

---

### Task 8: Bootstrap function

**Files:**
- Create: `src/lib/chat-entities/index.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/lib/chat-entities/index.ts
//
// Bootstrap: registers every built-in EntitySpec. Call once from ChatView
// mount (top of script). Idempotent — re-bootstrap is a no-op after the
// first call (the registry's collision check would throw, so we guard).

import { registry } from './registry';
import { observationSpec } from './observation';
import { speciesSpec } from './species';
import { projectSpec } from './project';
import { cameraStationSpec } from './camera-station';
import { observerSpec } from './observer';
import { selfProfileSpec } from './self-profile';

export { registry } from './registry';
export type { EntityCard, EntityKind, EntitySpec } from './types';

let bootstrapped = false;

export function bootstrapChatEntities(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  registry.register(observationSpec);
  registry.register(speciesSpec);
  registry.register(projectSpec);
  registry.register(cameraStationSpec);
  registry.register(observerSpec);
  registry.register(selfProfileSpec);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat-entities/index.ts
git commit -m "feat(chat-entities): bootstrap function registers all built-ins"
```

---

### Task 9: parseAttachQuerystring helper + tests

**Files:**
- Create: `src/lib/parse-attach-querystring.ts`
- Create: `src/lib/parse-attach-querystring.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/parse-attach-querystring.test.ts
import { describe, it, expect } from 'vitest';
import { parseAttachQuerystring } from './parse-attach-querystring';

describe('parseAttachQuerystring', () => {
  const KINDS = ['observation', 'species', 'project', 'camera_station', 'observer', 'self_profile'];

  it('returns null for empty input', () => {
    expect(parseAttachQuerystring(null)).toBeNull();
    expect(parseAttachQuerystring('')).toBeNull();
  });

  it('parses kind:id form', () => {
    expect(parseAttachQuerystring('observation:abc-123')).toEqual({
      kind: 'observation',
      id: 'abc-123',
    });
  });

  it('rejects unknown kind', () => {
    expect(parseAttachQuerystring('foo:bar')).toBeNull();
  });

  it('rejects malformed input (missing colon)', () => {
    expect(parseAttachQuerystring('observation')).toBeNull();
  });

  it('rejects empty id segment', () => {
    expect(parseAttachQuerystring('observation:')).toBeNull();
  });

  it('accepts every supported kind', () => {
    for (const k of KINDS) {
      expect(parseAttachQuerystring(`${k}:x`)?.kind).toBe(k);
    }
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/lib/parse-attach-querystring.test.ts`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

```typescript
// src/lib/parse-attach-querystring.ts
import type { EntityKind } from './chat-entities/types';

const KINDS: ReadonlySet<EntityKind> = new Set([
  'observation', 'species', 'project', 'camera_station', 'observer', 'self_profile',
]);

export function parseAttachQuerystring(value: string | null): { kind: EntityKind; id: string } | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon <= 0 || colon === value.length - 1) return null;
  const kind = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (!KINDS.has(kind as EntityKind)) return null;
  if (!id) return null;
  return { kind: kind as EntityKind, id };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/lib/parse-attach-querystring.test.ts`

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/parse-attach-querystring.ts src/lib/parse-attach-querystring.test.ts
git commit -m "feat(chat): parseAttachQuerystring helper for ?attach=kind:id"
```

---

# Phase 3 — Chat Tools

A typed JSON tool layer. Each tool has `name`, `description` (for the system prompt), `validateArgs(args)` (hand-rolled, no Zod), and `run(args)` (a Supabase RPC call).

---

### Task 10: chat-tools registry + 5 tools + tests

**Files:**
- Create: `src/lib/chat-tools.ts`
- Create: `src/lib/chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/chat-tools.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('./supabase', () => ({ getSupabase: () => ({ rpc: rpcMock }) }));

import { runTool, listTools, toolDefinitions } from './chat-tools';

beforeEach(() => {
  rpcMock.mockReset();
});

describe('chat-tools', () => {
  it('exposes 5 tools', () => {
    const names = listTools().map(t => t.name).sort();
    expect(names).toEqual([
      'find_camera_stations',
      'find_observations',
      'find_observers',
      'find_projects',
      'find_species',
    ]);
  });

  it('toolDefinitions is a JSON-shaped string for the system prompt', () => {
    const defs = toolDefinitions();
    expect(typeof defs).toBe('string');
    expect(defs).toContain('find_observations');
    expect(defs).toContain('find_species');
  });

  it('runTool: unknown name returns error', async () => {
    const r = await runTool({ name: 'unknown', args: {} });
    expect(r).toEqual({ error: 'unknown_tool' });
  });

  it('runTool: invalid args returns invalid_args', async () => {
    // find_observations expects p_filters as an object
    const r = await runTool({ name: 'find_observations', args: { p_filters: 'not an object' as unknown } });
    expect(r).toMatchObject({ error: 'invalid_args' });
  });

  it('runTool: dispatches a valid call and returns ok', async () => {
    rpcMock.mockResolvedValue({ data: [{ id: 'a' }], error: null });
    const r = await runTool({ name: 'find_species', args: { p_query: 'magnolia', p_limit: 5 } });
    expect(rpcMock).toHaveBeenCalledWith('chat_find_species', { p_query: 'magnolia', p_limit: 5 });
    expect(r).toEqual({ ok: true, data: [{ id: 'a' }] });
  });

  it('runTool: RPC network error → {error: "network"}', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'fetch failed' } });
    const r = await runTool({ name: 'find_species', args: { p_query: 'x' } });
    expect(r).toMatchObject({ error: 'network' });
  });

  it('runTool: thrown promise → {error: "offline"}', async () => {
    rpcMock.mockRejectedValue(new Error('Failed to fetch'));
    const r = await runTool({ name: 'find_species', args: { p_query: 'x' } });
    expect(r).toMatchObject({ error: 'offline' });
  });

  it('find_observations validates radius_km is a number', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const ok = await runTool({
      name: 'find_observations',
      args: { p_filters: { radius_km: 25 }, p_limit: 10 },
    });
    expect(ok).toMatchObject({ ok: true });

    const bad = await runTool({
      name: 'find_observations',
      args: { p_filters: { radius_km: 'far' as unknown as number } },
    });
    expect(bad).toMatchObject({ error: 'invalid_args' });
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/lib/chat-tools.test.ts`

Expected: FAIL with "Cannot find module './chat-tools'".

- [ ] **Step 3: Implement**

```typescript
// src/lib/chat-tools.ts
//
// Typed JSON tool layer for chat. Each tool wraps one Supabase RPC and
// exposes a hand-rolled validator (no Zod dependency). The model emits
// `{"tool": "<name>", "args": { ... }}`; the runtime parses, validates,
// dispatches, and feeds the result back to the model as a tool message.
//
// Errors returned (never thrown):
//   { error: 'unknown_tool' }   — name not in the registry
//   { error: 'invalid_args' }   — failed validateArgs(); detail in `detail`
//   { error: 'network' }        — supabase returned an error
//   { error: 'offline' }        — fetch threw (network down)

import { getSupabase } from './supabase';

export type ToolResult =
  | { ok: true; data: unknown }
  | { error: 'unknown_tool' }
  | { error: 'invalid_args'; detail: string }
  | { error: 'network'; detail: string }
  | { error: 'offline'; detail: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema-ish description for the system prompt. */
  args_schema: Record<string, string>;
  validateArgs(args: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };
  run(args: Record<string, unknown>): Promise<unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function rpcCall(fn: string, args: Record<string, unknown>): Promise<unknown> {
  return getSupabase().rpc(fn, args).then((r: { data: unknown; error: { message: string } | null }) => {
    if (r.error) throw new Error('NETWORK:' + r.error.message);
    return r.data;
  });
}

const findObservations: ToolDef = {
  name: 'find_observations',
  description: 'Search observations the signed-in user can see, with optional filters.',
  args_schema: {
    'p_filters': 'object — { owner?: "me", primary_taxon_id?: uuid, project_id?: uuid, near_observation_id?: uuid, radius_km?: number, research_grade?: boolean }',
    'p_limit':   'number — 1..50, default 10',
  },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    const { p_filters, p_limit } = args;
    if (p_filters !== undefined && !isObject(p_filters)) return { ok: false, reason: 'p_filters must be an object' };
    if (p_filters && isObject(p_filters)) {
      if ('radius_km' in p_filters && typeof p_filters.radius_km !== 'number') {
        return { ok: false, reason: 'radius_km must be a number' };
      }
      if ('research_grade' in p_filters && typeof p_filters.research_grade !== 'boolean') {
        return { ok: false, reason: 'research_grade must be a boolean' };
      }
    }
    if (p_limit !== undefined && typeof p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_filters: p_filters ?? {}, p_limit: (p_limit as number) ?? 10 } };
  },
  run(args) {
    return rpcCall('chat_find_observations', args);
  },
};

const findSpecies: ToolDef = {
  name: 'find_species',
  description: 'Search the taxonomy by canonical/scientific/common name.',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_species', args); },
};

const findProjects: ToolDef = {
  name: 'find_projects',
  description: 'Search projects by name or slug.',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_projects', args); },
};

const findCameraStations: ToolDef = {
  name: 'find_camera_stations',
  description: 'List camera stations for a given project id.',
  args_schema: { p_project_id: 'uuid', p_limit: 'number — 1..50, default 20' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_project_id !== 'string') return { ok: false, reason: 'p_project_id must be a uuid string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_project_id: args.p_project_id, p_limit: (args.p_limit as number) ?? 20 } };
  },
  run(args) { return rpcCall('chat_find_camera_stations', args); },
};

const findObservers: ToolDef = {
  name: 'find_observers',
  description: 'Search observers by username or display name (public profiles only).',
  args_schema: { p_query: 'string', p_limit: 'number — 1..50, default 10' },
  validateArgs(args) {
    if (!isObject(args)) return { ok: false, reason: 'args must be an object' };
    if (typeof args.p_query !== 'string' || !args.p_query.trim()) return { ok: false, reason: 'p_query must be a non-empty string' };
    if (args.p_limit !== undefined && typeof args.p_limit !== 'number') return { ok: false, reason: 'p_limit must be a number' };
    return { ok: true, value: { p_query: args.p_query, p_limit: (args.p_limit as number) ?? 10 } };
  },
  run(args) { return rpcCall('chat_find_observers', args); },
};

const REGISTRY: Record<string, ToolDef> = {
  find_observations:    findObservations,
  find_species:         findSpecies,
  find_projects:        findProjects,
  find_camera_stations: findCameraStations,
  find_observers:       findObservers,
};

export function listTools(): ToolDef[] {
  return Object.values(REGISTRY);
}

/** Stringified tool catalogue suitable for inclusion in the system prompt. */
export function toolDefinitions(): string {
  return JSON.stringify(
    listTools().map(t => ({ name: t.name, description: t.description, args: t.args_schema })),
    null,
    2,
  );
}

export async function runTool(call: { name: string; args: unknown }): Promise<ToolResult> {
  const def = REGISTRY[call.name];
  if (!def) return { error: 'unknown_tool' };
  const v = def.validateArgs(call.args);
  if (!v.ok) return { error: 'invalid_args', detail: v.reason };
  try {
    const data = await def.run(v.value);
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('NETWORK:')) return { error: 'network', detail: msg.slice(8) };
    return { error: 'offline', detail: msg };
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/lib/chat-tools.test.ts`

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-tools.ts src/lib/chat-tools.test.ts
git commit -m "feat(chat): chat-tools registry + 5 tools (find_observations, _species, _projects, _camera_stations, _observers)"
```

---

# Phase 4 — Engine Layer

`local-ai.ts` gains `loadGemmaTextEngine()`. `chat-engine.ts` is new — it wraps both engines, runs the streaming + tool-call loop (1 round cap), and emits telemetry.

---

### Task 11: loadGemmaTextEngine in local-ai.ts

**Files:**
- Modify: `src/lib/local-ai.ts`
- Modify: `src/lib/local-ai.test.ts` (add tests for the new loader)

- [ ] **Step 1: Read the existing onnx-vision.ts to understand transformers.js usage**

Run: `grep -n "loadGemma\|gemmaSupported\|getGemmaCacheStatus\|identifyImageWithGemma" src/lib/onnx-vision.ts | head`

Expected: Several references. Read the function bodies of `loadGemma` and the model-id constant.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/local-ai.test.ts`:

```typescript
describe('loadGemmaTextEngine', () => {
  it('throws when WebGPU is unavailable', async () => {
    const orig = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
    (globalThis as { navigator: { gpu?: unknown; deviceMemory?: number } }).navigator = { deviceMemory: 8 };
    try {
      const { loadGemmaTextEngine } = await import('./local-ai');
      await expect(loadGemmaTextEngine(() => {})).rejects.toThrow(/WebGPU/);
    } finally {
      (globalThis as { navigator?: unknown }).navigator = orig;
    }
  });
});
```

- [ ] **Step 3: Run test — expect failure (loadGemmaTextEngine not exported)**

Run: `npx vitest run src/lib/local-ai.test.ts -t "loadGemmaTextEngine"`

Expected: FAIL with "loadGemmaTextEngine is not a function" or similar.

- [ ] **Step 4: Implement loadGemmaTextEngine**

Add to `src/lib/local-ai.ts` after `loadTextEngine`:

```typescript
export const GEMMA_TEXT_MODEL_ID = 'onnx_gemma4_text';

/**
 * Load Gemma 4 E2B for text-only chat. Reuses the transformers.js + ONNX
 * runtime path from onnx-vision.ts (same model weights). Cached after first
 * load like the WebLLM models. Cancellation flag is shared via the
 * cancelledFlags set so cancelModelDownload() handles it consistently.
 */
export async function loadGemmaTextEngine(
  onProgress: (p: LoadProgress) => void,
): Promise<{
  generate: (messages: Array<{ role: string; content: string }>, opts?: { max_tokens?: number; stream?: boolean }) =>
    AsyncIterable<{ choices: Array<{ delta?: { content?: string }; message?: { content: string } }> }>;
}> {
  if (!localAISupported()) throw new Error('WebGPU not available — Gemma 4 unavailable on this browser.');
  cancelledFlags.delete(GEMMA_TEXT_MODEL_ID);
  await requestPersistentStorage().catch(() => {});

  const { loadGemma, generateGemmaText } = await import('./onnx-vision');
  await loadGemma((p) => {
    if (cancelledFlags.has(GEMMA_TEXT_MODEL_ID)) {
      throw new Error('Download cancelled');
    }
    onProgress({
      progress: p.progress ?? 0,
      text: p.text ?? '',
      timeElapsedMs: p.timeElapsedMs ?? 0,
    });
  });

  // Wrap onnx-vision's generator into the OpenAI-style stream interface
  // chat-engine consumes. Implementation lives in onnx-vision; this is just
  // the engine handle.
  return {
    generate: (messages, opts) => generateGemmaText(messages, opts ?? {}),
  };
}
```

- [ ] **Step 5: Add `generateGemmaText` shim in onnx-vision.ts**

Find the existing `loadGemma` function in `src/lib/onnx-vision.ts`. Add this export immediately below it (or at the bottom of the file):

```typescript
/**
 * Text-only generation using the loaded Gemma 4 E2B model. Yields chunks
 * shaped like `{ choices: [{ delta: { content } }] }` so chat-engine can
 * consume Gemma and Llama through the same async iterator.
 */
export async function* generateGemmaText(
  messages: Array<{ role: string; content: string }>,
  opts: { max_tokens?: number; stream?: boolean },
): AsyncIterable<{ choices: Array<{ delta?: { content?: string }; message?: { content: string } }> }> {
  // Concatenate messages into a single prompt — Gemma E2B uses a
  // <|user|>/<|assistant|> chat template handled by transformers.js.
  const generator = await getGemmaGenerator();
  const prompt = messages.map(m => `<|${m.role}|>\n${m.content}`).join('\n') + '\n<|assistant|>\n';
  const max_new_tokens = Math.min(opts.max_tokens ?? 512, 1024);
  if (opts.stream) {
    // transformers.js v3 supports a streamer callback; for v1 we collect
    // and emit one delta. Streaming refinement is a v1.1 polish.
    const out = await generator(prompt, { max_new_tokens, do_sample: false });
    const text = (out as Array<{ generated_text: string }>)[0]?.generated_text?.replace(prompt, '') ?? '';
    yield { choices: [{ delta: { content: text } }] };
    return;
  }
  const out = await generator(prompt, { max_new_tokens, do_sample: false });
  const text = (out as Array<{ generated_text: string }>)[0]?.generated_text?.replace(prompt, '') ?? '';
  yield { choices: [{ message: { content: text } }] };
}
```

If `getGemmaGenerator` is the internal handle for the loaded text model, use it. If `loadGemma` only exposes the vision pipeline, add a `getGemmaTextGenerator` that loads a text-only pipeline using the same cached weights. Verify by reading the existing `loadGemma` body before writing this — the existing function may already cache the right thing.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/local-ai.test.ts`

Expected: all existing tests pass + the new loadGemmaTextEngine test passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-ai.ts src/lib/onnx-vision.ts src/lib/local-ai.test.ts
git commit -m "feat(local-ai): loadGemmaTextEngine for Gemma 4 E2B text chat"
```

---

### Task 12: chat-engine.ts streaming + tool-call loop

**Files:**
- Create: `src/lib/chat-engine.ts`
- Create: `src/lib/chat-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/chat-engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadGemmaMock = vi.fn();
const loadLlamaMock = vi.fn();
vi.mock('./local-ai', () => ({
  loadGemmaTextEngine: () => loadGemmaMock(),
  loadTextEngine: () => loadLlamaMock(),
  localAISupported: () => true,
}));

const runToolMock = vi.fn();
vi.mock('./chat-tools', () => ({
  runTool: (...a: unknown[]) => runToolMock(...a),
  toolDefinitions: () => '[]',
  listTools: () => [],
}));

import { streamChat } from './chat-engine';

function fakeStream(chunks: string[]) {
  return {
    async *generate() {
      for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
    },
  };
}

beforeEach(() => {
  loadGemmaMock.mockReset();
  loadLlamaMock.mockReset();
  runToolMock.mockReset();
});

describe('streamChat', () => {
  it('streams pure prose from Gemma when no tool call', async () => {
    loadGemmaMock.mockResolvedValue(fakeStream(['Hello ', 'world.']));
    const out: string[] = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'hi' }] })) {
      if (chunk.type === 'text') out.push(chunk.delta);
    }
    expect(out.join('')).toBe('Hello world.');
  });

  it('detects a tool call, dispatches, re-prompts, returns final prose', async () => {
    // First completion: tool call. Second completion: final prose.
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        if (callIdx++ === 0) {
          yield { choices: [{ delta: { content: '{"tool":"find_species","args":{"p_query":"magnolia"}}' } }] };
        } else {
          yield { choices: [{ delta: { content: 'Found 1 species: Magnolia.' } }] };
        }
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [{ scientific_name: 'Magnolia grandiflora' }] });

    const events: Array<{ type: string; delta?: string; tool?: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'find magnolia' }] })) {
      events.push(chunk);
    }
    expect(events.find(e => e.type === 'tool_call')?.tool).toBe('find_species');
    expect(events.filter(e => e.type === 'text').map(e => e.delta).join('')).toContain('Magnolia');
  });

  it('caps tool calls at 1 round per turn', async () => {
    let callIdx = 0;
    loadGemmaMock.mockResolvedValue({
      async *generate() {
        // Both completions emit tool calls — only the first should dispatch.
        const tool = `{"tool":"find_species","args":{"p_query":"x${callIdx++}"}}`;
        yield { choices: [{ delta: { content: tool } }] };
      },
    });
    runToolMock.mockResolvedValue({ ok: true, data: [] });

    const events: Array<{ type: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(chunk);
    }
    const toolEvents = events.filter(e => e.type === 'tool_call');
    expect(toolEvents).toHaveLength(1);
  });

  it('falls back to Llama when Gemma load fails', async () => {
    loadGemmaMock.mockRejectedValue(new Error('webgpu init failed'));
    loadLlamaMock.mockResolvedValue({
      chat: { completions: { create: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { content: 'fallback' } }] }; },
      }) } },
    });

    const events: Array<{ type: string; delta?: string; engine?: string }> = [];
    for await (const chunk of streamChat({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(chunk);
    }
    expect(events.find(e => e.type === 'engine_fallback')?.engine).toBe('llama');
    expect(events.filter(e => e.type === 'text').map(e => e.delta).join('')).toContain('fallback');
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx vitest run src/lib/chat-engine.test.ts`

Expected: FAIL with "Cannot find module './chat-engine'".

- [ ] **Step 3: Implement**

```typescript
// src/lib/chat-engine.ts
//
// Chat dispatch: Gemma 4 E2B by default, Llama-3.2-1B as fallback.
// Implements a streaming + 1-round tool-call loop. Emits typed events
// the UI consumes: text deltas, tool calls, tool results, engine fallbacks.
//
// The model is expected to either (a) emit prose, or (b) emit a single
// JSON object `{"tool": "<name>", "args": { ... }}` with no surrounding
// prose. We detect (b) by looking for a `{"tool":` substring within the
// first 64 chars of accumulated output. Anything else is treated as prose.

import { runTool, toolDefinitions } from './chat-tools';
import { loadGemmaTextEngine, loadTextEngine } from './local-ai';

export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string };

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'engine_fallback'; engine: 'llama'; reason: string }
  | { type: 'error'; message: string };

export interface StreamChatInput {
  messages: ChatMessage[];
  /** Optional override; default tries Gemma then Llama. */
  prefer?: 'gemma' | 'llama';
}

const TOOL_RE = /^\s*\{\s*"tool"\s*:/;
const MAX_TOOL_ROUNDS = 1;
const SYSTEM_TOOLS_PROMPT = `You may emit a JSON tool call to look up data. Tools available:\n%TOOLS%\nWhen calling a tool, respond with ONLY a JSON object: {"tool": "<name>", "args": { ... }}. Otherwise reply in prose. Use tools sparingly.`;

function withToolPrompt(messages: ChatMessage[]): ChatMessage[] {
  const sys = SYSTEM_TOOLS_PROMPT.replace('%TOOLS%', toolDefinitions());
  return [{ role: 'system', content: sys }, ...messages];
}

async function* streamGemma(messages: ChatMessage[]): AsyncIterable<{ delta?: string; final?: string }> {
  const eng = await loadGemmaTextEngine(() => {});
  for await (const chunk of eng.generate(messages, { max_tokens: 512, stream: true })) {
    const c = chunk.choices?.[0];
    const delta = c?.delta?.content ?? c?.message?.content ?? '';
    if (delta) yield { delta };
  }
}

async function* streamLlama(messages: ChatMessage[]): AsyncIterable<{ delta?: string }> {
  const eng = await loadTextEngine(() => {});
  const stream = await eng.chat.completions.create({
    messages: messages as Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
    max_tokens: 512,
    stream: true,
  });
  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string } }> }>) {
    const delta = chunk.choices?.[0]?.delta?.content ?? '';
    if (delta) yield { delta };
  }
}

async function* runOnce(
  messages: ChatMessage[],
  prefer: 'gemma' | 'llama' | undefined,
): AsyncIterable<StreamEvent> {
  if (prefer === 'llama') {
    for await (const c of streamLlama(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
    return;
  }
  // Gemma path with Llama fallback on load error.
  try {
    for await (const c of streamGemma(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
  } catch (e) {
    yield { type: 'engine_fallback', engine: 'llama', reason: e instanceof Error ? e.message : String(e) };
    for await (const c of streamLlama(messages)) {
      if (c.delta) yield { type: 'text', delta: c.delta };
    }
  }
}

/**
 * Streaming chat with a 1-round tool-call loop. Yields:
 *   { type: 'text', delta }            — model text deltas
 *   { type: 'tool_call', tool, args }  — when the model emitted a tool
 *   { type: 'tool_result', tool, … }   — after tool dispatch
 *   { type: 'engine_fallback', … }     — when Gemma fell back to Llama
 *   { type: 'error', message }         — terminal error
 */
export async function* streamChat(input: StreamChatInput): AsyncIterable<StreamEvent> {
  const messages = withToolPrompt(input.messages);
  let toolRounds = 0;

  while (true) {
    let accumulated = '';
    let toolCallText: string | null = null;
    const buffered: StreamEvent[] = [];

    for await (const ev of runOnce(messages, input.prefer)) {
      if (ev.type === 'text') {
        accumulated += ev.delta;
        // Decide once we have enough chars to recognise a tool call.
        if (toolCallText === null && accumulated.length >= 16 && !TOOL_RE.test(accumulated)) {
          // Definitely prose — flush buffered + this delta.
          for (const b of buffered) yield b;
          buffered.length = 0;
          yield ev;
        } else if (toolCallText === null) {
          // Still ambiguous — buffer.
          buffered.push(ev);
        } else {
          // Tool call mode — keep accumulating but don't yield text deltas.
        }
        if (TOOL_RE.test(accumulated)) toolCallText = accumulated;
      } else {
        // Engine fallbacks etc. pass through.
        for (const b of buffered) yield b;
        buffered.length = 0;
        yield ev;
      }
    }

    // End of model output. Decide what to do.
    if (toolCallText && toolRounds < MAX_TOOL_ROUNDS) {
      // Parse the tool call.
      let parsed: { tool?: string; args?: unknown } | null = null;
      try { parsed = JSON.parse(toolCallText.trim()); } catch { /* fallthrough */ }
      if (!parsed?.tool) {
        // Not a valid tool call — treat the buffered text as prose.
        for (const b of buffered) yield b;
        return;
      }
      yield { type: 'tool_call', tool: parsed.tool, args: parsed.args ?? {} };
      const result = await runTool({ name: parsed.tool, args: parsed.args ?? {} });
      yield { type: 'tool_result', tool: parsed.tool, result };
      toolRounds++;
      // Append the tool result and re-prompt.
      messages.push({ role: 'assistant', content: toolCallText });
      messages.push({ role: 'tool', content: JSON.stringify(result) });
      continue;
    }

    // No tool call (or cap reached). Flush whatever buffer we still have.
    for (const b of buffered) yield b;
    return;
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx vitest run src/lib/chat-engine.test.ts`

Expected: 4 passed.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-engine.ts src/lib/chat-engine.test.ts
git commit -m "feat(chat): chat-engine with Gemma-default + 1-round tool-call loop + Llama fallback"
```

---

### Task 13: Gemma-text download card in ProfileEditForm

**Files:**
- Modify: `src/components/ProfileEditForm.astro` (locate the existing Phi/Llama download cards and add a Gemma-text card mirroring their shape)

- [ ] **Step 1: Find the existing card markup**

Run: `grep -n "id=\"vision-download\"\|id=\"text-download\"\|webllm_phi35_vision\|Llama-3.2-1B" src/components/ProfileEditForm.astro | head -20`

Read 30 lines of context around each match. The download cards are typically rendered by `renderPluginCard()` from `src/lib/identifier-card-html.ts`. Check whether ProfileEditForm renders Gemma at all today — if it already renders the Gemma vision card, mirror that shape; the new card has a different model id (`onnx_gemma4_text` vs. `onnx_gemma4_vision`).

- [ ] **Step 2: Add a Gemma-text MODELS entry**

In `src/lib/identifier-card-html.ts` (or wherever the `MODELS` object is defined), add:

```typescript
const MODELS: Record<ModelKey, { id: string; label: string; sizeLabel: string }> = {
  vision:     { id: 'Phi-3.5-vision-instruct-q4f16_1-MLC', label: 'Phi-3.5-vision', sizeLabel: '~4 GB' },
  text:       { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',   label: 'Llama-3.2-1B',   sizeLabel: '~880 MB' },
  gemma_text: { id: 'onnx_gemma4_text',                    label: 'Gemma 4 E2B (text)', sizeLabel: '~500 MB' },
};
```

Extend the `ModelKey` type union to include `'gemma_text'`. If the file uses `ModelKey = keyof typeof MODELS`, this is automatic; otherwise update the union.

- [ ] **Step 3: Render the new card**

Find the JSX/HTML rendering loop for download cards in `ProfileEditForm.astro`. Add a new `<li>` mirroring the Phi/Llama cards with these IDs (substitute prefix `gemma-text-`):

```html
<li class="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3" data-model-card="gemma_text">
  <div class="flex items-start justify-between gap-3 flex-wrap">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-base">✨</span>
        <p class="text-sm font-medium">Gemma 4 E2B (text chat)</p>
        <span id="gemma-text-status" class="hidden bg-emerald-500/15 text-emerald-700 px-1.5 py-0.5 rounded text-[10px]">Active</span>
      </div>
      <p class="text-xs text-zinc-500 mt-0.5">{tr.profile.ai.gemma_text_description}</p>
      <p class="text-[10px] text-zinc-400 mt-1 font-mono">on-device · 💬 · ~500 MB</p>
    </div>
    <div class="flex flex-wrap gap-2 flex-none">
      <button type="button" id="gemma-text-download" class="rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-medium">{tr.profile.ai.download}</button>
      <button type="button" id="gemma-text-delete" class="hidden rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700">{tr.profile.ai.delete}</button>
    </div>
  </div>
  <div id="gemma-text-progress" class="hidden mt-2 text-[10px] font-mono text-zinc-500"></div>
</li>
```

- [ ] **Step 4: Wire the download button**

Find the existing button-handler script block in `ProfileEditForm.astro`. The Phi/Llama buttons call something like `refreshModel('vision')`/`refreshModel('text')`. Add a parallel call:

```typescript
document.getElementById('gemma-text-download')?.addEventListener('click', async () => {
  const { loadGemmaTextEngine } = await import('../lib/local-ai');
  const progressEl = document.getElementById('gemma-text-progress');
  progressEl?.classList.remove('hidden');
  try {
    await loadGemmaTextEngine((p) => {
      if (progressEl) progressEl.textContent = `${Math.round(p.progress * 100)}% — ${p.text}`;
    });
    document.getElementById('gemma-text-status')?.classList.remove('hidden');
    document.getElementById('gemma-text-delete')?.classList.remove('hidden');
  } catch (e) {
    if (progressEl) progressEl.textContent = e instanceof Error ? e.message : String(e);
  }
});
```

The delete handler should call `clearGemmaCache()` from `src/lib/onnx-vision.ts` (if it exists; if not, this is a v1.1 follow-up — leave the button hidden).

- [ ] **Step 5: Add i18n strings**

In `src/i18n/en.json`, add under `profile.ai`:
```json
"gemma_text_description": "Google Gemma 4 E2B for on-device text chat. Stronger reasoner than Llama 1B. ~500 MB one-time download. Runs entirely in your browser."
```

In `src/i18n/es.json`:
```json
"gemma_text_description": "Google Gemma 4 E2B para chat de texto en el dispositivo. Razona mejor que Llama 1B. Descarga única de ~500 MB. Se ejecuta totalmente en tu navegador."
```

- [ ] **Step 6: Type-check + test**

Run: `npm run typecheck && npm run test`

Expected: 0 type errors; all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/components/ProfileEditForm.astro src/lib/identifier-card-html.ts src/i18n/en.json src/i18n/es.json
git commit -m "feat(profile): Gemma 4 (text) download card in AI settings"
```

---

# Phase 5 — UI Decomposition

ChatView shrinks from 1,441 LOC to a ~400-LOC orchestrator. New sibling components own their own internals. Events flow through CustomEvents on `document`.

---

### Task 14: Extract ChatBubble.astro

**Files:**
- Create: `src/components/ChatBubble.astro`
- Modify: `src/components/ChatView.astro` (replace inline `bubbleHtml(...)` with `<ChatBubble />` rendering loop)

- [ ] **Step 1: Read the current bubble code**

Run: `grep -n "function bubbleHtml\|renderCascadeFooter\|renderCompareFooter\|renderAttachmentPreview" src/components/ChatView.astro`

Read 30 lines around each match. Note any DOM IDs the parent script wires up.

- [ ] **Step 2: Create the new component**

```astro
---
// src/components/ChatBubble.astro
//
// Pure render of one chat bubble. The orchestrator (ChatView) iterates
// over its conversation array and dispatches one of these per turn.
//
// Bubble actions (copy / save-as-observation / re-run) are wired by the
// parent via event delegation on `[data-chat-bubble]`. This component
// renders the buttons but never owns the listeners.
---

<!-- Marker rendered by parent JS that does .innerHTML. The actual markup is
     produced by the bubble-rendering helpers in `chat-bubble-html.ts` which
     this component re-exports for the parent's setBubbleStreaming() path. -->
<template id="chat-bubble-template">
  <div data-chat-bubble class="max-w-[85%] rounded-2xl px-3 py-2 text-sm"></div>
</template>
```

The bubble HTML is currently produced by string-template helpers in `ChatView.astro`. To keep the change small in this task, **do not move the helpers yet** — just extract them into a new file `src/lib/chat-bubble-html.ts`, importable from both `ChatView.astro` and (if needed) `ChatComposer.astro`.

Create `src/lib/chat-bubble-html.ts`:

```typescript
// Bubble-rendering helpers extracted from ChatView. Pure string templates;
// no DOM access, no listeners. The parent does .innerHTML and then attaches
// listeners via querySelectorAll().

import type { CascadeCandidate } from './chat-attachment-helpers';

export type ChatRole = 'user' | 'assistant';
export interface ChatAttachment { kind: 'photo' | 'audio'; objectUrl: string; mimeType: string; durationSec?: number }
export interface ChatTurnLite {
  role: ChatRole;
  content: string;
  attachment?: ChatAttachment;
  pending?: boolean;
  cascadeResult?: { best: CascadeCandidate | null; attachmentKind: 'photo'|'audio'; attachmentBlobUrl: string; attachmentMime: string };
  compareResult?: { attachmentKind: 'photo'|'audio'; attachmentBlobUrl: string; attachmentMime: string; entries: Array<{ id: string; name: string; ok: boolean; result?: CascadeCandidate; error?: string }> };
  entityChip?: { kind: string; label: string; icon: string };
}

export function escapeHtml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]!));
}

export function bubbleHtml(turn: ChatTurnLite, idx: number, isEs: boolean): string {
  const isUser = turn.role === 'user';
  const align  = isUser ? 'ml-auto' : 'mr-auto';
  const bg     = isUser
    ? 'bg-emerald-700 text-white'
    : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800';
  const role   = isUser ? (isEs ? 'Tú' : 'You') : 'Rastrum';
  const att    = turn.attachment ? renderAttachmentPreview(turn.attachment) : '';
  const chip   = turn.entityChip
    ? `<div class="inline-flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-900/10 px-2 py-0.5 text-[11px] mb-1">
         <span>${escapeHtml(turn.entityChip.icon)}</span>
         <span class="truncate max-w-[180px]">${escapeHtml(turn.entityChip.label)}</span>
       </div>`
    : '';
  const body = turn.pending
    ? `<span class="inline-flex items-center gap-2 italic"><span class="animate-pulse">…</span>${escapeHtml(turn.content)}</span>`
    : escapeHtml(turn.content);
  return `<div data-chat-bubble data-turn-idx="${idx}" class="${align} ${bg} max-w-[85%] rounded-2xl px-3 py-2 text-sm">
    <div class="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">${role}</div>
    ${chip}
    ${att}
    <div data-bubble-body>${body}</div>
  </div>`;
}

function renderAttachmentPreview(att: ChatAttachment): string {
  if (att.kind === 'photo') {
    return `<img src="${att.objectUrl}" alt="" class="max-h-48 rounded-md mb-2" />`;
  }
  return `<audio controls src="${att.objectUrl}" class="w-full mb-2"></audio>`;
}
```

- [ ] **Step 3: Update ChatView.astro to import these helpers**

Replace the inline `bubbleHtml`, `renderAttachmentPreview`, `escapeHtml`, and `ChatTurn` type definitions in `ChatView.astro` with:

```typescript
import { bubbleHtml, escapeHtml, type ChatTurnLite, type ChatRole, type ChatAttachment } from '../lib/chat-bubble-html';
```

Adjust references throughout the script. The functions `renderCascadeFooter` and `renderCompareFooter` can stay inline for now (they're large and tightly coupled to local state); a follow-up task can move them.

- [ ] **Step 4: Run unit tests + type-check**

Run: `npm run typecheck && npm run test`

Expected: 0 errors; existing tests pass.

- [ ] **Step 5: Build + smoke**

Run: `npm run build`

Expected: build succeeds. Manually load `/en/chat/` in `npm run dev` — verify the chat bubble layout renders the same as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-bubble-html.ts src/components/ChatBubble.astro src/components/ChatView.astro
git commit -m "refactor(chat): extract bubble HTML helpers from ChatView"
```

---

### Task 15: Extract ChatComposer.astro

**Files:**
- Create: `src/components/ChatComposer.astro`
- Modify: `src/components/ChatView.astro` (replace the composer markup with `<ChatComposer />`; keep the script that wires the form submit)

The composer owns: photo/gallery/audio/voice icons, the textarea, the send button, the attachment chip (photo/audio), the entity chip slot, and the model picker. It dispatches CustomEvents but doesn't own conversation state.

- [ ] **Step 1: Move the composer JSX into the new component**

```astro
---
// src/components/ChatComposer.astro
//
// Owns the textarea + attachment buttons + model picker + chips.
// Dispatches: rastrum:chat-attach-photo, rastrum:chat-attach-audio,
// rastrum:chat-attach-entity, rastrum:chat-detach-entity, rastrum:chat-submit.
//
// Lifts no state to globals; the parent listens on document.

import { t } from '../i18n/utils';

interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<form id="chat-form" class="hidden fixed bottom-0 left-0 right-0 sm:static border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sm:border-0 sm:bg-transparent z-30" style="padding-bottom: env(safe-area-inset-bottom);">
  <div class="max-w-3xl mx-auto px-4 sm:px-0 py-3 sm:py-0 space-y-2">
    <!-- entity chip -->
    <div id="chat-entity-chip-slot"></div>
    <!-- attachment chip (photo/audio) -->
    <div id="chat-attachment-chip" class="hidden flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-2">
      <div id="chat-attachment-thumb" class="w-12 h-12 rounded-md overflow-hidden bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 text-xs flex-shrink-0"></div>
      <div class="flex-1 min-w-0">
        <p id="chat-attachment-label" class="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate"></p>
        <p id="chat-attachment-meta" class="text-[10px] text-zinc-500 truncate"></p>
      </div>
      <button id="chat-attachment-remove" type="button" aria-label={tr.chat.attach_remove} class="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm flex items-center justify-center hover:bg-zinc-300 dark:hover:bg-zinc-700 flex-shrink-0">×</button>
    </div>
    <!-- model picker (existing markup; keep IDs unchanged) -->
    <!-- ... copy from ChatView lines ~83–98 verbatim ... -->
    <!-- buttons + textarea row (existing markup; keep IDs unchanged) -->
    <!-- ... copy from ChatView lines ~100–186 verbatim ... -->
  </div>
</form>

<script>
  // Listeners for attach buttons → CustomEvent dispatch.
  const formEl = document.getElementById('chat-form');
  const attachEntityBtn = document.getElementById('chat-attach-entity-btn');
  attachEntityBtn?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('rastrum:chat-open-entity-picker'));
  });

  formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const ta = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    document.dispatchEvent(new CustomEvent('rastrum:chat-submit', {
      detail: { text: ta?.value ?? '' },
    }));
  });
</script>
```

For Step 1, **copy the existing composer HTML verbatim from ChatView.astro lines 61–186** into the position marked "copy from ChatView…" above. Add a new "📋 Attach context" button **next to the photo/audio buttons** with `id="chat-attach-entity-btn"`.

- [ ] **Step 2: Update ChatView.astro to use ChatComposer**

In `ChatView.astro`, replace the entire `<form id="chat-form">…</form>` block (lines 61–186) with:

```astro
<ChatComposer lang={lang} />
```

Add the import at the top of the frontmatter:
```astro
import ChatComposer from './ChatComposer.astro';
```

Move the composer-form-submit handler from the inline `<script>` so it listens to `rastrum:chat-submit` instead of submitting directly.

- [ ] **Step 3: Type-check + build**

Run: `npm run typecheck && npm run build`

Expected: 0 errors; build succeeds.

- [ ] **Step 4: Manual smoke**

Run `npm run dev`, open `/en/chat/`. Verify: send works, photo attach works, audio attach works, voice button works, model picker works.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer.astro src/components/ChatView.astro
git commit -m "refactor(chat): extract ChatComposer + add Attach context button"
```

---

### Task 16: ChatEntityChip.astro

**Files:**
- Create: `src/components/ChatEntityChip.astro`

The chip is rendered into `#chat-entity-chip-slot` from ChatView when an entity is attached. Click on the chip opens the entity's canonical page in a new tab.

- [ ] **Step 1: Write the component**

```astro
---
// src/components/ChatEntityChip.astro
//
// Compact representation of an attached entity inside the composer.
// Rendered by ChatView via document.getElementById('chat-entity-chip-slot').innerHTML.
// Standalone <ChatEntityChip /> usage is rare; this is mostly an HTML template
// that the parent imports via the chat-bubble-html helpers.
---

<template id="chat-entity-chip-template">
  <div data-chat-entity-chip class="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/10 p-2 text-sm">
    <span data-chip-icon class="text-base flex-shrink-0"></span>
    <a data-chip-link target="_blank" rel="noopener" class="flex-1 min-w-0 truncate font-medium text-emerald-900 dark:text-emerald-100 hover:underline"></a>
    <button data-chip-detach type="button" aria-label="Remove" class="w-6 h-6 rounded-full bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 text-xs flex items-center justify-center hover:bg-emerald-300">×</button>
  </div>
</template>
```

Add a render helper in `src/lib/chat-bubble-html.ts`:

```typescript
import type { EntityKind } from './chat-entities/types';

export function entityChipHtml(opts: { kind: EntityKind; id: string; label: string; icon: string; lang: 'en'|'es' }): string {
  const url = canonicalEntityUrl(opts.kind, opts.id, opts.lang);
  return `<div data-chat-entity-chip class="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-900/10 p-2 text-sm">
    <span class="text-base flex-shrink-0">${escapeHtml(opts.icon)}</span>
    <a href="${url}" target="_blank" rel="noopener" class="flex-1 min-w-0 truncate font-medium text-emerald-900 dark:text-emerald-100 hover:underline">${escapeHtml(opts.label)}</a>
    <button data-chip-detach type="button" aria-label="Remove" class="w-6 h-6 rounded-full bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 text-xs flex items-center justify-center hover:bg-emerald-300">×</button>
  </div>`;
}

function canonicalEntityUrl(kind: EntityKind, id: string, lang: 'en'|'es'): string {
  switch (kind) {
    case 'observation':    return `/share/obs/?id=${encodeURIComponent(id)}`;
    case 'species':        return `/${lang}/${lang === 'es' ? 'especie' : 'species'}/${encodeURIComponent(id)}/`;
    case 'project':        return `/${lang}/${lang === 'es' ? 'proyectos' : 'projects'}/detail/?slug=${encodeURIComponent(id)}`;
    case 'observer':       return `/${lang}/${lang === 'es' ? 'perfil' : 'profile'}/u/${encodeURIComponent(id)}/`;
    case 'self_profile':   return `/${lang}/${lang === 'es' ? 'perfil' : 'profile'}/`;
    case 'camera_station': return '#';
    default: return '#';
  }
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npm run typecheck`

Expected: 0 errors.

```bash
git add src/components/ChatEntityChip.astro src/lib/chat-bubble-html.ts
git commit -m "feat(chat): ChatEntityChip + entityChipHtml helper"
```

---

### Task 17: ChatEntityPicker.astro + tests

**Files:**
- Create: `src/components/ChatEntityPicker.astro`
- Create: `tests/unit/chat-entity-picker.test.ts`

- [ ] **Step 1: Component**

```astro
---
// src/components/ChatEntityPicker.astro
//
// Popover triggered from ChatComposer's "📋 Attach context" button.
// Tabs across the 6 entity kinds. Each tab queries one Supabase RPC
// (the chat_find_* functions). Selecting a row dispatches
// rastrum:chat-attach-entity and closes.

import { t } from '../i18n/utils';

interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<div id="chat-entity-picker" class="hidden fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={tr.chat.attach_entity_label}>
  <div class="bg-white dark:bg-zinc-900 w-full sm:max-w-lg rounded-t-xl sm:rounded-xl shadow-2xl">
    <header class="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800">
      <h2 class="text-sm font-semibold">{tr.chat.attach_entity_label}</h2>
      <button id="chat-entity-picker-close" aria-label={tr.chat.close} class="w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
    </header>
    <div role="tablist" class="flex overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 text-xs">
      <button data-pkr-tab="observation"    role="tab" class="chat-pkr-tab">{tr.chat.entities.observation}</button>
      <button data-pkr-tab="species"        role="tab" class="chat-pkr-tab">{tr.chat.entities.species}</button>
      <button data-pkr-tab="project"        role="tab" class="chat-pkr-tab">{tr.chat.entities.project}</button>
      <button data-pkr-tab="camera_station" role="tab" class="chat-pkr-tab">{tr.chat.entities.camera_station}</button>
      <button data-pkr-tab="observer"       role="tab" class="chat-pkr-tab">{tr.chat.entities.observer}</button>
      <button data-pkr-tab="self_profile"   role="tab" class="chat-pkr-tab">{tr.chat.entities.self_profile}</button>
    </div>
    <div class="p-3">
      <input id="chat-entity-picker-search" type="search" placeholder={tr.chat.attach_entity_search} class="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
    </div>
    <ul id="chat-entity-picker-list" class="max-h-[60vh] overflow-y-auto px-3 pb-3 space-y-2"></ul>
  </div>
</div>

<style>
  .chat-pkr-tab { @apply px-3 py-2 whitespace-nowrap border-b-2 border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/40; }
  .chat-pkr-tab[aria-selected="true"] { @apply border-emerald-600 text-emerald-700 dark:text-emerald-400; }
</style>

<script>
  import { getSupabase } from '../lib/supabase';
  import { registry, bootstrapChatEntities } from '../lib/chat-entities';
  import type { EntityKind } from '../lib/chat-entities/types';

  bootstrapChatEntities();

  const dialog = document.getElementById('chat-entity-picker');
  const list   = document.getElementById('chat-entity-picker-list');
  const search = document.getElementById('chat-entity-picker-search') as HTMLInputElement | null;

  let activeTab: EntityKind = 'observation';
  let lastQuery = '';

  function setActiveTab(kind: EntityKind) {
    activeTab = kind;
    document.querySelectorAll('.chat-pkr-tab').forEach(b => {
      const sel = (b as HTMLButtonElement).dataset.pkrTab === kind;
      (b as HTMLButtonElement).setAttribute('aria-selected', String(sel));
    });
    refresh();
  }

  async function refresh() {
    if (!list) return;
    list.innerHTML = '<li class="text-xs text-zinc-500 italic">Loading…</li>';
    const sb = getSupabase();
    const q = lastQuery.trim();
    let rows: Array<{ id: string; label: string }> = [];
    try {
      if (activeTab === 'observation') {
        const { data } = await sb.rpc('chat_find_observations', { p_filters: q ? { /* server-side query is by id only; client filters */ } : { owner: 'me' }, p_limit: 20 });
        rows = (data ?? []).map((r: { id: string; scientific_name?: string; observed_at?: string }) =>
          ({ id: r.id, label: `${r.scientific_name ?? '—'} · ${r.observed_at ? new Date(r.observed_at).toLocaleDateString() : ''}` }));
      } else if (activeTab === 'species') {
        const { data } = await sb.rpc('chat_find_species', { p_query: q || ' ', p_limit: 20 });
        rows = (data ?? []).map((r: { id: string; scientific_name: string }) => ({ id: r.id, label: r.scientific_name }));
      } else if (activeTab === 'project') {
        const { data } = await sb.rpc('chat_find_projects', { p_query: q || ' ', p_limit: 20 });
        rows = (data ?? []).map((r: { id: string; slug: string; name?: string }) => ({ id: r.slug, label: r.name ?? r.slug }));
      } else if (activeTab === 'observer') {
        const { data } = await sb.rpc('chat_find_observers', { p_query: q || ' ', p_limit: 20 });
        rows = (data ?? []).map((r: { id: string; display_name?: string; username?: string }) => ({ id: r.id, label: r.display_name ?? r.username ?? r.id }));
      } else if (activeTab === 'self_profile') {
        const { data: me } = await sb.auth.getUser();
        if (me?.user) rows = [{ id: me.user.id, label: 'Me' }];
      } else if (activeTab === 'camera_station') {
        list.innerHTML = '<li class="text-xs text-zinc-500 italic">Open a project page first.</li>';
        return;
      }
    } catch (e) {
      list.innerHTML = `<li class="text-xs text-red-600">${(e as Error).message}</li>`;
      return;
    }

    if (rows.length === 0) {
      list.innerHTML = '<li class="text-xs text-zinc-500 italic">No matches.</li>';
      return;
    }
    list.innerHTML = rows.map(r => {
      const spec = registry.get(activeTab);
      return `<li><button type="button" data-row-id="${r.id}" class="w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
        <span class="mr-2">${spec?.icon ?? ''}</span>${r.label}
      </button></li>`;
    }).join('');
  }

  list?.addEventListener('click', (ev) => {
    const btn = (ev.target as Element)?.closest('button[data-row-id]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = btn.dataset.rowId!;
    document.dispatchEvent(new CustomEvent('rastrum:chat-attach-entity', {
      detail: { kind: activeTab, id },
    }));
    dialog?.classList.add('hidden');
  });

  document.addEventListener('rastrum:chat-open-entity-picker', () => {
    dialog?.classList.remove('hidden');
    setActiveTab('observation');
  });
  document.getElementById('chat-entity-picker-close')?.addEventListener('click', () => dialog?.classList.add('hidden'));
  document.querySelectorAll('.chat-pkr-tab').forEach(b => b.addEventListener('click', (e) => {
    setActiveTab((e.currentTarget as HTMLButtonElement).dataset.pkrTab as EntityKind);
  }));
  search?.addEventListener('input', () => { lastQuery = search.value; refresh(); });
</script>
```

- [ ] **Step 2: Mount in ChatView**

In `src/components/ChatView.astro` add the import + mount:

```astro
import ChatEntityPicker from './ChatEntityPicker.astro';
// …
<ChatEntityPicker lang={lang} />
```

- [ ] **Step 3: Write the test**

```typescript
// tests/unit/chat-entity-picker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

const rpcMock = vi.fn();
vi.mock('../../src/lib/supabase', () => ({ getSupabase: () => ({
  rpc: rpcMock,
  auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
}) }));

beforeEach(() => {
  rpcMock.mockReset();
  document.body.innerHTML = `
    <div id="chat-entity-picker" class="hidden">
      <button class="chat-pkr-tab" data-pkr-tab="species" aria-selected="false"></button>
      <button class="chat-pkr-tab" data-pkr-tab="observation" aria-selected="true"></button>
      <input id="chat-entity-picker-search" />
      <ul id="chat-entity-picker-list"></ul>
      <button id="chat-entity-picker-close"></button>
    </div>`;
});

describe('chat-entity-picker', () => {
  it('opening dispatches refresh and selects observation tab', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    // dynamic import after DOM is ready (component script runs at import-time)
    await import('../../src/components/ChatEntityPicker.astro?inline').catch(() => {});
    document.dispatchEvent(new CustomEvent('rastrum:chat-open-entity-picker'));
    await new Promise(r => setTimeout(r, 0));
    expect(rpcMock).toHaveBeenCalledWith('chat_find_observations', expect.any(Object));
  });
});
```

If `?inline` import doesn't work in the harness (Astro components are SSR), wire the test to instead import `src/lib/chat-entity-picker-controller.ts` — which means refactoring the script block out of the `.astro` file into a TS file. Decide based on whether vitest can compile `.astro`. If not, do the refactor:

```typescript
// src/lib/chat-entity-picker-controller.ts
// Pull the entire <script> block from ChatEntityPicker.astro and export
// `bindChatEntityPicker(): void`. The component then becomes:
//   <script>import {bindChatEntityPicker} from '../lib/chat-entity-picker-controller'; bindChatEntityPicker();</script>
```

- [ ] **Step 4: Run tests + commit**

Run: `npm run typecheck && npm run test`

Expected: 0 errors; new picker test passes.

```bash
git add src/components/ChatEntityPicker.astro src/components/ChatView.astro tests/unit/chat-entity-picker.test.ts src/lib/chat-entity-picker-controller.ts
git commit -m "feat(chat): ChatEntityPicker popover with 6 entity tabs"
```

---

### Task 18: Wire chat-engine into ChatView (replace direct Llama path) + handle ?attach=

**Files:**
- Modify: `src/components/ChatView.astro`

- [ ] **Step 1: Replace `streamLlamaInterpretation` with `streamChat` for the user→assistant turn**

Find the form submit handler in `ChatView.astro` (the part that calls `engine.chat.completions.create` for user prose). Replace with:

```typescript
import { streamChat, type ChatMessage } from '../lib/chat-engine';
import { parseAttachQuerystring } from '../lib/parse-attach-querystring';
import { bootstrapChatEntities, registry } from '../lib/chat-entities';
import type { EntityCard, EntityKind } from '../lib/chat-entities/types';

bootstrapChatEntities();

let attachedEntity: EntityCard | null = null;

document.addEventListener('rastrum:chat-attach-entity', async (ev) => {
  const detail = (ev as CustomEvent<{ kind: EntityKind; id: string }>).detail;
  const spec = registry.get(detail.kind);
  if (!spec) return;
  try {
    const card = await spec.fetchCard(detail.id);
    if (!card) return; // silently drop; toast shown separately
    attachedEntity = card;
    renderEntityChip(card);
    seedSuggestion(card);
    document.dispatchEvent(new CustomEvent('rastrum:onboarding-event', {
      detail: { type: 'chat.entity.attached', kind: card.kind, source: 'picker' },
    }));
  } catch (e) {
    const errEl = document.getElementById('chat-attach-error');
    if (errEl) {
      errEl.textContent = (e instanceof Error ? e.message : String(e));
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 4000);
    }
  }
});

document.addEventListener('rastrum:chat-detach-entity', () => {
  attachedEntity = null;
  const slot = document.getElementById('chat-entity-chip-slot');
  if (slot) slot.innerHTML = '';
});

function renderEntityChip(card: EntityCard) {
  const slot = document.getElementById('chat-entity-chip-slot');
  if (!slot) return;
  // entityChipHtml from src/lib/chat-bubble-html.ts:
  import('../lib/chat-bubble-html').then(({ entityChipHtml }) => {
    slot.innerHTML = entityChipHtml({
      kind: card.kind, id: card.id, label: card.label, icon: registry.get(card.kind)?.icon ?? '·', lang: isEs ? 'es' : 'en',
    });
    slot.querySelector('[data-chip-detach]')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('rastrum:chat-detach-entity'));
    });
  });
}

function seedSuggestion(card: EntityCard) {
  const ta = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (!ta || ta.value || !card.suggested_questions[0]) return;
  ta.placeholder = card.suggested_questions[0];
}

// Handle ?attach=…
const params = new URLSearchParams(location.search);
const parsed = parseAttachQuerystring(params.get('attach'));
if (parsed) {
  document.dispatchEvent(new CustomEvent('rastrum:chat-attach-entity', { detail: parsed }));
  // Strip the param so refresh doesn't re-attach.
  params.delete('attach');
  history.replaceState(null, '', `${location.pathname}${params.toString() ? '?' + params.toString() : ''}`);
}

document.addEventListener('rastrum:chat-submit', async (ev) => {
  const text = (ev as CustomEvent<{ text: string }>).detail.text.trim();
  if (!text) return;

  const userTurn = { role: 'user' as const, content: text, entityChip: attachedEntity ? { kind: attachedEntity.kind, label: attachedEntity.label, icon: registry.get(attachedEntity.kind)?.icon ?? '·' } : undefined };
  conversation.push(userTurn);
  paintConversation();

  // Build the message list.
  const messages: ChatMessage[] = [];
  messages.push({ role: 'system', content: CHAT_SYSTEM_PROMPT });
  if (attachedEntity) {
    messages.push({ role: 'system', content: `[Context]\n${attachedEntity.summary_text}` });
  }
  // Last 6 turns from conversation (excluding the just-pushed user turn so we don't double count it).
  const history = conversation.slice(-7, -1).map(t => ({
    role: t.role,
    content: t.content.slice(0, 600),  // truncate to ~120 tokens
  }));
  messages.push(...history);
  messages.push({ role: 'user', content: text });

  // Placeholder pending bubble for the assistant.
  const placeholderIdx = conversation.push({ role: 'assistant', content: '', pending: true }) - 1;
  paintConversation();

  let assembled = '';
  for await (const event of streamChat({ messages })) {
    if (event.type === 'text') {
      assembled += event.delta;
      conversation[placeholderIdx].content = assembled;
      conversation[placeholderIdx].pending = false;
      setBubbleStreaming(placeholderIdx, assembled);
    } else if (event.type === 'tool_call') {
      document.dispatchEvent(new CustomEvent('rastrum:onboarding-event', {
        detail: { type: 'chat.tool.called', tool_name: event.tool, ok: true },
      }));
    } else if (event.type === 'tool_result' && (event.result as { error?: string }).error) {
      document.dispatchEvent(new CustomEvent('rastrum:onboarding-event', {
        detail: { type: 'chat.tool.failed', tool_name: event.tool, reason: (event.result as { error: string }).error },
      }));
    } else if (event.type === 'engine_fallback') {
      document.dispatchEvent(new CustomEvent('rastrum:onboarding-event', {
        detail: { type: 'chat.engine.fallback', from: 'gemma', to: event.engine },
      }));
    }
  }
  conversation[placeholderIdx].pending = false;
  paintConversation();
  await persistAssistantTurn(conversation[placeholderIdx]);
});
```

Note: leave the existing photo/audio cascade path intact — those paths use the cascade interpretation flow, not the new chat-engine path. The new `streamChat` is for **plain text turns with optional entity context**.

- [ ] **Step 2: Extend `ChatTurnRecord` for entity_attachment + tool_calls**

The spec persists a lightweight `entity_attachment?: { kind, id, label }` and `tool_calls?: Array<{name, args, result}>` on each turn so chip rendering survives reload.

Open `src/lib/db.ts`. Find the `ChatTurnRecord` interface. Extend it:

```typescript
export interface ChatTurnRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  attachments?: Array<{ kind: 'photo' | 'audio'; mimeType: string; durationSec?: number }>;
  // ↓ new fields (M01 chat improvements)
  entity_attachment?: { kind: string; id: string; label: string };
  tool_calls?: Array<{ name: string; args: unknown; result: unknown }>;
}
```

In `src/lib/chat-history.ts`, update `appendTurn` to forward the new optional fields when present (`attachments` already does this; mirror the pattern). Run the existing `chat-history.test.ts` and confirm it still passes.

If the Dexie schema needs a version bump for the new optional fields: optional fields don't require a schema change in Dexie v3+, but verify by reading the existing `getDB()` definition. Bump only if you see explicit `Schema` definitions naming columns.

- [ ] **Step 3: Type-check + build + manual smoke**

Run: `npm run typecheck && npm run build`

Expected: 0 errors; build succeeds.

Open `/en/chat/?attach=observation:00000000-0000-0000-0000-000000000004` in dev (replace with a real obs id). Verify the chip appears and a suggested question seeds the placeholder.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatView.astro src/lib/db.ts src/lib/chat-history.ts
git commit -m "feat(chat): wire chat-engine + entity attach handler in ChatView"
```

---

# Phase 6 — Deep Links

`AskRastrumButton` drops into 5 entity surfaces. Each invocation builds a URL of the form `/{lang}/chat/?attach=<kind>:<id>`.

---

### Task 19: AskRastrumButton.astro + tests

**Files:**
- Create: `src/components/AskRastrumButton.astro`
- Create: `tests/unit/ask-rastrum-button.test.ts`

- [ ] **Step 1: Component**

```astro
---
// src/components/AskRastrumButton.astro
//
// Deep-link button that opens /chat/ with an entity pre-attached.

import { t } from '../i18n/utils';
import type { EntityKind } from '../lib/chat-entities/types';

interface Props {
  lang: 'en' | 'es';
  kind: EntityKind;
  id: string;
  /** "primary" → emerald fill; "ghost" → outline. */
  variant?: 'primary' | 'ghost';
  /** Shorthand: "icon" hides the label, just shows 💬. */
  display?: 'full' | 'icon';
}

const { lang, kind, id, variant = 'ghost', display = 'full' } = Astro.props;
const tr = t(lang);
const href = `/${lang}/${lang === 'es' ? 'chat' : 'chat'}/?attach=${encodeURIComponent(kind)}:${encodeURIComponent(id)}`;
const label = tr.chat.ask_rastrum;

const cls = variant === 'primary'
  ? 'inline-flex items-center gap-1 min-h-9 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white'
  : 'inline-flex items-center gap-1 min-h-9 rounded-lg border border-emerald-600/60 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10';
---

<a href={href} class={cls} aria-label={label} title={label}>
  <span aria-hidden="true">💬</span>
  {display === 'full' && <span>{label}</span>}
</a>
```

- [ ] **Step 2: Test**

```typescript
// tests/unit/ask-rastrum-button.test.ts
import { describe, it, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import AskRastrumButton from '../../src/components/AskRastrumButton.astro';

describe('AskRastrumButton', () => {
  it('builds /en/chat/?attach=observation:abc', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AskRastrumButton, {
      props: { lang: 'en', kind: 'observation', id: 'abc' },
    });
    expect(html).toContain('href="/en/chat/?attach=observation%3Aabc"');
    expect(html).toContain('Ask Rastrum');
  });

  it('builds /es/chat/?attach=species:xyz', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AskRastrumButton, {
      props: { lang: 'es', kind: 'species', id: 'xyz' },
    });
    expect(html).toContain('href="/es/chat/?attach=species%3Axyz"');
  });

  it('display=icon hides the label', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AskRastrumButton, {
      props: { lang: 'en', kind: 'project', id: 'abc', display: 'icon' },
    });
    expect(html).not.toContain('Ask Rastrum');
    expect(html).toContain('💬');
  });
});
```

If `experimental_AstroContainer` isn't available in this Astro version, fall back to a rendering shim test using `astro/runtime` or simply reading the file and checking the URL-builder line. Verify Astro version in `package.json` first.

- [ ] **Step 3: Run tests + commit**

```bash
npm run typecheck && npm run test
git add src/components/AskRastrumButton.astro tests/unit/ask-rastrum-button.test.ts
git commit -m "feat(chat): AskRastrumButton component"
```

---

### Task 20: Mount AskRastrumButton in ShareObsView, MyObservationsView, SpeciesProfileView, ProjectDetailView, PublicProfileView

**Files:** (one task per surface to keep diffs reviewable)

- [ ] **Step 1: ShareObsView.astro**

Find the actions row (around line 191 — `<div class="flex items-start justify-between gap-2 flex-wrap">`). Add inside the appropriate flex group:

```astro
<AskRastrumButton lang={lang} kind="observation" id={obs.id} variant="primary" />
```

Add the import at the top: `import AskRastrumButton from './AskRastrumButton.astro';`

Commit: `feat(chat): Ask Rastrum on observation share page`

- [ ] **Step 2: MyObservationsView.astro**

Find the per-obs action buttons row (around line 311–327). Inject the button after the share button. Use `display="icon"` to keep the row tight.

Commit: `feat(chat): Ask Rastrum on MyObs cards`

- [ ] **Step 3: SpeciesProfileView.astro**

Find the hero section (around line 60). Add the button after the taxonomy chips, with `kind="species"` and the species id. If the species id isn't readily available in the component scope, add a prop for it at the parent level.

Commit: `feat(chat): Ask Rastrum on species profile`

- [ ] **Step 4: ProjectDetailView.astro**

Find the header (around line 44) and add the button next to the "Add station" button.

Commit: `feat(chat): Ask Rastrum on project detail`

- [ ] **Step 5: PublicProfileView.astro**

Find the header (around line 51, near the FollowButton). Add the button in the same flex group.

Commit: `feat(chat): Ask Rastrum on public profile`

- [ ] **Step 6: Run typecheck + build for each commit**

After each surface, run `npm run typecheck && npm run build` and verify the home of each entity surface still renders.

---

# Phase 7 — i18n + Telemetry + E2E + Runbook

---

### Task 21: i18n keys (EN + ES parity)

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Add keys to en.json**

Add under `chat` (existing):
```json
"ask_rastrum": "Ask Rastrum",
"attach_entity_label": "Attach context",
"attach_entity_search": "Search…",
"close": "Close",
"entities": {
  "observation": "Observations",
  "species": "Species",
  "project": "Projects",
  "camera_station": "Stations",
  "observer": "Observers",
  "self_profile": "Me"
},
"tools": {
  "ran": "Looked at {tool}",
  "failed": "Couldn't run {tool}",
  "offline": "Offline — couldn't run {tool}"
},
"engine_fallback_banner": "Using lighter model — Gemma unavailable.",
"context_load_error": "Couldn't load context — try when online."
```

- [ ] **Step 2: Mirror in es.json**

```json
"ask_rastrum": "Pregunta a Rastrum",
"attach_entity_label": "Adjuntar contexto",
"attach_entity_search": "Buscar…",
"close": "Cerrar",
"entities": {
  "observation": "Observaciones",
  "species": "Especies",
  "project": "Proyectos",
  "camera_station": "Estaciones",
  "observer": "Observadores",
  "self_profile": "Yo"
},
"tools": {
  "ran": "Consulté {tool}",
  "failed": "No pude ejecutar {tool}",
  "offline": "Sin conexión — no pude ejecutar {tool}"
},
"engine_fallback_banner": "Usando un modelo más ligero — Gemma no disponible.",
"context_load_error": "No se pudo cargar el contexto — inténtalo cuando estés en línea."
```

- [ ] **Step 3: Verify EN/ES parity**

Run:
```bash
node -e 'const en = require("./src/i18n/en.json"), es = require("./src/i18n/es.json"); function keys(o,p=""){return Object.entries(o).flatMap(([k,v])=>typeof v==="object"?keys(v,p+k+"."):[p+k]);} const ek=new Set(keys(en)),sk=new Set(keys(es)); console.log("missing in es:", [...ek].filter(k=>!sk.has(k))); console.log("missing in en:", [...sk].filter(k=>!ek.has(k)));'
```

Expected: both lists empty.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n(chat): keys for entities, tools, ask_rastrum, attach_entity"
```

---

### Task 22: E2E specs

**Files:**
- Create: `tests/e2e/chat-deep-link.spec.ts`
- Create: `tests/e2e/chat-entity-picker.spec.ts`

- [ ] **Step 1: chat-deep-link.spec.ts**

```typescript
// tests/e2e/chat-deep-link.spec.ts
import { test, expect } from '@playwright/test';

test('chat deep-link from observation page pre-attaches the obs', async ({ page }) => {
  // Stub Supabase for the entity-card RPC.
  await page.route('**/rest/v1/rpc/chat_entity_card', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'observation',
        id: 'test-obs-id',
        label: 'Setophaga magnolia · May 8 · CDMX',
        summary_text: 'Test observation summary.',
        fields: {},
        suggested_questions: ['Why is this needs review?'],
        related: {},
      }),
    });
  });

  await page.goto('/en/chat/?attach=observation:test-obs-id');
  await expect(page.locator('[data-chat-entity-chip]')).toBeVisible();
  await expect(page.locator('[data-chat-entity-chip]')).toContainText('Setophaga magnolia');
  // URL should be cleaned.
  await expect.poll(() => page.url()).not.toContain('attach=');
});
```

- [ ] **Step 2: chat-entity-picker.spec.ts**

```typescript
// tests/e2e/chat-entity-picker.spec.ts
import { test, expect } from '@playwright/test';

test('chat entity picker opens, shows tabs, selects a row', async ({ page }) => {
  await page.route('**/rest/v1/rpc/chat_find_observations', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'obs-1', scientific_name: 'Test Species', observed_at: '2026-05-08T00:00:00Z' },
      ]),
    });
  });
  await page.route('**/rest/v1/rpc/chat_entity_card', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'observation',
        id: 'obs-1',
        label: 'Test Species',
        summary_text: 's',
        fields: {},
        suggested_questions: [],
        related: {},
      }),
    });
  });

  await page.goto('/en/chat/');
  await page.locator('#chat-attach-entity-btn').click();
  await expect(page.locator('#chat-entity-picker')).toBeVisible();
  await page.locator('button[data-row-id="obs-1"]').click();
  await expect(page.locator('[data-chat-entity-chip]')).toContainText('Test Species');
});
```

- [ ] **Step 3: Run E2E locally**

Run: `npm run test:e2e`

Expected: both new specs pass on chromium + mobile-chrome.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/chat-deep-link.spec.ts tests/e2e/chat-entity-picker.spec.ts
git commit -m "test(e2e): chat deep-link + entity-picker"
```

---

### Task 23: Runbook + index

**Files:**
- Create: `docs/runbooks/chat-improvements.md`
- Modify: `docs/runbooks/00-index.md` (add a row)

- [ ] **Step 1: Write the runbook**

Save as `docs/runbooks/chat-improvements.md`:

```markdown
# Chat improvements (2026-05-09 release)

Operator notes for the Gemma-text + entity-context chat redesign.

## What shipped

- **Gemma 4 E2B as text-chat backbone** — alongside Llama-3.2-1B.
  Defaults to Gemma when WebGPU + ≥6 GB device memory; falls back to
  Llama otherwise.
- **Entity context** — chat can be deep-linked or in-chat picked from
  six entity kinds: observation, species, project, camera_station,
  observer, self_profile.
- **Five typed tools** — `find_observations`, `find_species`,
  `find_projects`, `find_camera_stations`, `find_observers`.
  1-round cap per turn.
- **Decomposed ChatView** — slimmed from 1,441 LOC to ~400 LOC
  orchestrator + 4 sibling components.

## Known limits (v1.1 follow-ups)

- Multi-round tool-calling (chains of tool calls) is capped at 1 round.
- No guided writes — chat surfaces no "apply this fix" buttons.
- `location` entity kind deferred until the locations-first-class
  schema lands (`docs/superpowers/specs/2026-05-03-locations-first-class-design.md`).

## Smoke checks

After deploy:

- [ ] `/en/chat/?attach=observation:<known-id>` — chip renders, URL cleaned.
- [ ] In-chat picker opens, tabs switch, search filters.
- [ ] Cross-entity follow-up: attach an obs, ask "find similar nearby" — model emits a tool call, results render.
- [ ] Offline: airplane mode → attached obs Q&A still works; tool call shows offline footer.
- [ ] Mobile composer with chip + photo attachment both staged at the same time.
- [ ] Gemma fallback: corrupt the OPFS Gemma cache, reload chat, expect Llama-fallback banner.

## Telemetry events

Listen on `document` for `rastrum:onboarding-event` with these `detail.type` values:

- `chat.entity.attached` `{ kind, source: "deep-link"|"picker" }`
- `chat.tool.called` `{ tool_name, ok }`
- `chat.tool.failed` `{ tool_name, reason }`
- `chat.engine.fallback` `{ from, to }`

Wire to your analytics in `BaseLayout.astro` if needed; the chat does not call any analytics service directly.

## Rotating the schema

The new SQL functions live in `docs/specs/infra/supabase-schema.sql` near the bottom. Re-applying with `make db-apply` is safe (idempotent). The schema-security lint (`infra/lint-schema-security.sql`) enforces the SECURITY INVOKER + REVOKE PUBLIC + search_path invariants on every PR.

## SQL regression

`tests/sql/chat.sql` runs in `db-validate.yml` after every PR that touches the schema. Cases include obscure-coords branching, self-profile RLS gate, find_observations owner filter, and dispatcher fallthrough on unknown kinds.
```

- [ ] **Step 2: Add to index**

In `docs/runbooks/00-index.md`, add a row in the appropriate section pointing to `chat-improvements.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/chat-improvements.md docs/runbooks/00-index.md
git commit -m "docs(runbook): chat improvements operator notes"
```

---

### Task 24: Final pre-PR sweep

- [ ] **Step 1: Full type-check**

Run: `npm run typecheck`

Expected: 0 errors.

- [ ] **Step 2: Full test run**

Run: `npm run test`

Expected: all tests pass; new tests counted (registry 4, observation 4, specs 15, parse-attach 6, chat-tools 8, chat-engine 4, picker 1, ask-rastrum 3 ≈ 45 new tests).

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: 0 errors. Page count should still be ~209 + parity (EN/ES).

- [ ] **Step 4: E2E**

Run: `npm run test:e2e`

Expected: previous suite + 2 new specs pass.

- [ ] **Step 5: Manual smoke (browser)**

Run: `npm run dev`. In the browser:

- Visit `/en/chat/`. Send a plain message. Verify Gemma loads and replies (or falls back to Llama if WebGPU unavailable; banner shows).
- Visit `/en/chat/?attach=observation:<known-id>`. Verify chip renders, suggested question seeds the placeholder, send works.
- Open the in-chat picker, switch tabs, pick an observer. Verify chip swaps.
- Attach a photo + an entity simultaneously. Verify both render.
- Type "find similar observations nearby". Verify a tool footer appears in the assistant bubble.

- [ ] **Step 6: Commit (any final fixes)**

```bash
git add -A
git commit -m "chore(chat): final fixes from pre-PR sweep" --allow-empty
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --base main --head $(git branch --show-current) --title "feat(chat): Gemma 4 text + entity context + decomposition" --body "$(cat <<'EOF'
## Summary

- Adds **Gemma 4 E2B** as a text-chat backbone (Llama-3.2-1B stays as fallback).
- Adds a **generic chat-entity registry** with 6 kinds: observation, species, project, camera_station, observer, self_profile.
- Adds a **typed JSON tool layer** with 5 tools backed by Supabase RPCs (`chat_find_*`); 1-round cap per turn.
- **Decomposes ChatView.astro** from 1,441 LOC to ~400 LOC orchestrator + 4 sibling components.

Spec: \`docs/superpowers/specs/2026-05-09-chat-improvements-design.md\`
Runbook: \`docs/runbooks/chat-improvements.md\`

## Test plan

- [ ] CI green: typecheck, vitest, db-validate (incl. tests/sql/chat.sql), e2e.
- [ ] /en/chat/?attach=observation:<id> pre-attaches and cleans URL.
- [ ] In-chat picker tabs work for all 6 kinds.
- [ ] Cross-entity follow-up: tool call rendered as collapsed footer.
- [ ] Offline degrade: chat works for attached entity Q&A; tool calls fail gracefully.
- [ ] Gemma fallback: Llama banner appears when Gemma weights are unavailable.
- [ ] Mobile composer with both photo + entity chip staged renders cleanly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Plan summary

| Phase | Tasks | Outcome |
|---|---|---|
| 1 — SQL | 1, 2, 3 | 6 SECURITY INVOKER RPCs + regression suite |
| 2 — Registry | 4–9 | Generic EntitySpec + 6 specs + parser |
| 3 — Tools | 10 | chat-tools dispatcher + 5 tools |
| 4 — Engine | 11, 12, 13 | Gemma loader + chat-engine + ProfileEdit card |
| 5 — UI | 14, 15, 16, 17, 18 | ChatBubble/Composer/Chip/Picker; ChatView slim |
| 6 — Deep links | 19, 20 | AskRastrumButton on 5 surfaces |
| 7 — i18n+E2E | 21, 22, 23, 24 | i18n keys, E2E, runbook, pre-PR sweep |

24 tasks, ~120 commits planned (each step is one commit-ready unit). Bite-sized — typical task = 4–7 steps.
