# #809 — Real-time presence in ActiveObserversBanner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Subscribe to a Supabase Realtime broadcast channel so the active-observers count updates live when observers come online during the same session, without polling.

**Architecture:** On mount, the banner fetches the initial count via `community_active_observers_today(p_country)` RPC (unchanged). It then subscribes to a Realtime Broadcast channel `active-observers:{country}`. A Postgres `AFTER INSERT` trigger on `observations` broadcasts a `{count}` payload whenever a new synced observation lands. The client receives it and re-fetches or updates the displayed count. Privacy: the channel payload contains only the aggregate count integer — no user IDs or usernames ever transit the channel.

**Alternative considered:** Postgres Changes (row-level CDC) — rejected because it would leak observer_ids. Broadcast is the right primitive: server-controlled payload, no row data.

**Tech Stack:** TypeScript, Astro, Supabase Realtime (Broadcast), Vitest

---

## File Map

- **Modify:** `src/components/ActiveObserversBanner.astro` — subscribe + update on broadcast
- **Modify:** `src/lib/active-observers.ts` — add `subscribeToActiveObservers()` helper
- **Modify:** `tests/unit/active-observers.test.ts` — extend with subscription tests
- **Modify:** `docs/specs/infra/supabase-schema.sql` — add trigger + Realtime policy

---

### Task 1: Add `subscribeToActiveObservers()` helper + tests

**Files:**
- Modify: `src/lib/active-observers.ts`
- Modify: `tests/unit/active-observers.test.ts`

- [ ] **Step 1: Check existing tests**
```bash
cd /home/ubuntu/rastrum && cat tests/unit/active-observers.test.ts | head -40
```

- [ ] **Step 2: Write failing tests for subscription helper**

Add to `tests/unit/active-observers.test.ts`:

```typescript
import { subscribeToActiveObservers } from '../../src/lib/active-observers';

describe('subscribeToActiveObservers', () => {
  it('returns an unsubscribe function', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockSupabase = { channel: vi.fn().mockReturnValue(mockChannel) };

    const unsub = subscribeToActiveObservers(mockSupabase as any, 'MX', vi.fn());
    expect(typeof unsub).toBe('function');
    expect(mockSupabase.channel).toHaveBeenCalledWith('active-observers:MX');
  });

  it('calls onCount callback when broadcast received', () => {
    let broadcastHandler: ((payload: any) => void) | null = null;
    const mockChannel = {
      on: vi.fn().mockImplementation((_type, _opts, handler) => {
        broadcastHandler = handler;
        return mockChannel;
      }),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockSupabase = { channel: vi.fn().mockReturnValue(mockChannel) };
    const onCount = vi.fn();

    subscribeToActiveObservers(mockSupabase as any, 'MX', onCount);
    broadcastHandler?.({ payload: { count: 7 } });

    expect(onCount).toHaveBeenCalledWith(7);
  });

  it('unsubscribes channel on returned function call', () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    };
    const mockSupabase = { channel: vi.fn().mockReturnValue(mockChannel) };

    const unsub = subscribeToActiveObservers(mockSupabase as any, 'MX', vi.fn());
    unsub();
    expect(mockChannel.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run — expect fail**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/active-observers.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Implement `subscribeToActiveObservers()` in `src/lib/active-observers.ts`**

Add after the existing exports:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Subscribe to realtime active-observers count for a country.
 *
 * Privacy: the broadcast payload contains only `{ count: number }` —
 * no user IDs or PII ever transit this channel.
 *
 * @returns unsubscribe function — call on component unmount
 */
export function subscribeToActiveObservers(
  supabase: SupabaseClient,
  country: string,
  onCount: (count: number) => void,
): () => void {
  const channel = supabase
    .channel(`active-observers:${country}`)
    .on('broadcast', { event: 'count' }, (payload: { payload?: { count?: number } }) => {
      const count = payload?.payload?.count;
      if (typeof count === 'number') onCount(count);
    })
    .subscribe();

  return () => { channel.unsubscribe(); };
}
```

- [ ] **Step 5: Run tests — expect pass**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/active-observers.test.ts 2>&1 | tail -10
```

- [ ] **Step 6: Commit**
```bash
git add src/lib/active-observers.ts tests/unit/active-observers.test.ts
git commit -m "feat(active-observers): add subscribeToActiveObservers() realtime helper"
```

---

### Task 2: Wire subscription in `ActiveObserversBanner.astro`

**Files:**
- Modify: `src/components/ActiveObserversBanner.astro`

- [ ] **Step 1: Read current script block**
```bash
cd /home/ubuntu/rastrum && sed -n '55,97p' src/components/ActiveObserversBanner.astro
```

- [ ] **Step 2: Add subscription after initial fetch**

In the `<script>` block, after the initial `supabase.rpc(...)` fetch that populates the banner, add:

```typescript
import { subscribeToActiveObservers } from '../lib/active-observers';

// After the initial fetch:
let unsubscribe: (() => void) | null = null;

if (country) {
  unsubscribe = subscribeToActiveObservers(supabase, country, (newCount) => {
    const output = formatActiveObserversBanner({ count: newCount, region });
    if (output.text) {
      bannerEl.textContent = output.text;
      wrap.classList.remove('hidden');
    }
  });
}

// Clean up on page navigation (Astro view transitions)
document.addEventListener('astro:before-swap', () => {
  unsubscribe?.();
}, { once: true });
```

- [ ] **Step 3: TypeScript check**
```bash
cd /home/ubuntu/rastrum && npx tsc --noEmit 2>&1 | grep -v "huggingface\|onnx\|identify" | grep "error TS" | head -10
```

- [ ] **Step 4: Commit**
```bash
git add src/components/ActiveObserversBanner.astro
git commit -m "feat(active-observers): subscribe to realtime count updates in banner

Closes #809. Banner now updates live via Supabase Realtime Broadcast
channel 'active-observers:{country}'. Payload is count-only — no PII."
```

---

### Task 3: Schema — broadcast trigger

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Add trigger + Realtime policy to schema**

Append at the end of `docs/specs/infra/supabase-schema.sql`:

```sql
-- ====================================================
-- #809 — Active observers realtime broadcast trigger
-- ====================================================

-- Enable Realtime for broadcast (no row data — broadcast only)
-- The channel 'active-observers:{country}' is used by ActiveObserversBanner.

CREATE OR REPLACE FUNCTION public.broadcast_active_observer_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_country text;
  v_count   bigint;
BEGIN
  -- Only broadcast for synced observations (ignore drafts)
  IF NEW.sync_status != 'synced' THEN
    RETURN NEW;
  END IF;

  -- Get observer's country
  SELECT region_primary INTO v_country
  FROM public.users
  WHERE id = NEW.observer_id;

  IF v_country IS NULL THEN
    RETURN NEW;
  END IF;

  -- Re-compute today's count for that country
  SELECT count(DISTINCT o.observer_id)::bigint INTO v_count
  FROM public.observations o
  WHERE o.sync_status = 'synced'
    AND o.observer_id IN (
      SELECT id FROM public.users WHERE region_primary = v_country
    )
    AND date_trunc('day', o.observed_at AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC');

  -- Broadcast count-only payload — no PII
  PERFORM pg_notify(
    'active_observers_' || lower(v_country),
    json_build_object('count', v_count)::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_broadcast_active_observer ON public.observations;
CREATE TRIGGER tg_broadcast_active_observer
  AFTER INSERT OR UPDATE OF sync_status ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_active_observer_count();

REVOKE EXECUTE ON FUNCTION public.broadcast_active_observer_count() FROM PUBLIC;
```

- [ ] **Step 2: Commit**
```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): add broadcast_active_observer_count() trigger for #809"
```
