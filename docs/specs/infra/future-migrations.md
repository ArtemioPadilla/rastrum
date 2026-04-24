# Future Migrations

Schema changes that are **intentionally deferred** past v0.1. Each section lists
the trigger condition for pulling it forward, the migration path, and the preflight
steps required in Supabase.

---

## 1. Monthly partitioning of `observations` (v0.8+)

**Trigger condition:** `SELECT count(*) FROM observations > 1_000_000` **or**
`pg_total_relation_size('observations') > 20 GB`, whichever comes first.

**Why deferred from v0.1:**
- At <10K rows partitioning gives zero query benefit but adds real cost:
  every primary key must include `observed_at`, cross-partition queries
  slow down, and `pg_partman` retention jobs add operational surface.
- `partman.create_parent()` signature drifted between v4 and v5 and is
  Supabase-version-sensitive — running it on a fresh project is brittle.

**Preflight (before running this migration):**
```sql
-- 1. Confirm pg_partman is available in this Supabase project
SELECT * FROM pg_available_extensions WHERE name = 'pg_partman';

-- 2. Pin a known-good version
CREATE EXTENSION pg_partman WITH VERSION '5.1.0';

-- 3. Verify partman schema + role exist
SELECT has_schema_privilege('postgres','partman','USAGE');
```

**Migration sketch:**
```sql
BEGIN;

-- 1. Rename old table
ALTER TABLE public.observations RENAME TO observations_legacy;

-- 2. Create partitioned parent with composite PK
CREATE TABLE public.observations (
  LIKE public.observations_legacy INCLUDING ALL
) PARTITION BY RANGE (observed_at);

ALTER TABLE public.observations DROP CONSTRAINT observations_pkey;
ALTER TABLE public.observations ADD PRIMARY KEY (id, observed_at);

-- 3. Hand over to partman (monthly native partitions, 3 premade)
SELECT partman.create_parent(
  p_parent_table => 'public.observations',
  p_control      => 'observed_at',
  p_type         => 'native',
  p_interval     => 'monthly',
  p_premake      => 3
);

-- 4. Copy data (run in chunks if >1M rows)
INSERT INTO public.observations SELECT * FROM public.observations_legacy;

-- 5. Drop legacy after verification
-- DROP TABLE public.observations_legacy;

COMMIT;
```

**Retention policy:** none. Biodiversity observations are permanent records —
we never drop partitions, only detach and archive to cold storage if needed.

---

## 2. pgvector + Scout AI RAG (v0.5+)

**Trigger condition:** Rastrum Scout v0 ships (conversational field AI with
regional retrieval).

**Preflight:**
```sql
CREATE EXTENSION IF NOT EXISTS vector WITH VERSION '0.7.0';
```

**New tables (sketch):**
```sql
CREATE TABLE public.taxon_embeddings (
  taxon_id    uuid PRIMARY KEY REFERENCES taxa(id) ON DELETE CASCADE,
  embedding   vector(1024),              -- Voyage or Cohere embedding dim
  model       text NOT NULL,             -- 'voyage-3', 'cohere-embed-v4'
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX ON taxon_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 3. Research-grade consensus workflow (v0.5+)

Adds a `consensus_status` column and a `community_identifications` audit table.
See module `07-consensus.md` (planned) for detail.

---

## 4. Local Contexts BC Notices (v0.5+)

Adds `bc_notice_ids text[]` on `observations` plus a `notices` lookup table
mirroring [Local Contexts](https://localcontexts.org/) Biocultural labels.
Governance process (community consent) must land before schema.
