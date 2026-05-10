# #931 — getCachedSession() for Console Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate repeated `auth.getSession()` lock contention in Console components by introducing `getCachedSession()` — a short-lived in-memory cache for the full session object (including `access_token`), analogous to `getCachedUser()`.

**Architecture:** Console components need `session.access_token` to call Edge Functions via `adminClient`. All Console* components call `getSession()` independently on mount AND on every admin action. We add `getCachedSession()` to `src/lib/supabase.ts` (30s TTL, same pattern as `getCachedUser()`), then replace every `supabase.auth.getSession()` call in Console components with it. `SuggestIdModal` and `CommunityView` only need `user.id` → use `getCachedUser()` directly.

**Tech Stack:** TypeScript, Supabase JS v2, Astro, Vitest

---

## File Map

- **Modify:** `src/lib/supabase.ts` — add `getCachedSession()` + session cache + invalidation
- **Modify:** `tests/unit/supabase-cache.test.ts` (create) — unit tests for both cache functions
- **Modify:** `src/components/ConsoleAnomaliesView.astro` — getSession → getCachedSession
- **Modify:** `src/components/ConsoleAppealsView.astro`
- **Modify:** `src/components/ConsoleBadgesView.astro`
- **Modify:** `src/components/ConsoleBansView.astro`
- **Modify:** `src/components/ConsoleCommentsView.astro`
- **Modify:** `src/components/ConsoleCredentialsView.astro`
- **Modify:** `src/components/ConsoleErrorsView.astro`
- **Modify:** `src/components/ConsoleFeatureFlagsView.astro`
- **Modify:** `src/components/ConsoleFlagQueueView.astro`
- **Modify:** `src/components/ConsoleForensicsView.astro`
- **Modify:** `src/components/ConsoleHealthView.astro`
- **Modify:** `src/components/ConsoleObservationsView.astro`
- **Modify:** `src/components/ConsoleProposalsView.astro`
- **Modify:** `src/components/ConsoleSlideOver.astro`
- **Modify:** `src/components/ConsoleTaxaView.astro`
- **Modify:** `src/components/ConsoleUsersView.astro`
- **Modify:** `src/components/ConsoleWebhooksView.astro`
- **Modify:** `src/components/ExportView.astro`
- **Modify:** `src/components/SuggestIdModal.astro` — getCachedUser() (no token needed)
- **Modify:** `src/components/CommunityView.astro` — getCachedUser() (no token needed)
- **Modify:** `src/components/console/ExpertApplicationsBrowser.astro`
- **Modify:** `src/components/console/PlantNetQuotaPanel.astro`

---

### Task 1: Add `getCachedSession()` to `src/lib/supabase.ts`

**Files:**
- Modify: `src/lib/supabase.ts`
- Create: `tests/unit/supabase-cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/unit/supabase-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the cache logic in isolation by mocking the supabase client
vi.mock('../../src/lib/supabase', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/lib/supabase')>();
  return {
    ...mod,
    getSupabase: () => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-1', user: { id: 'u1' } } } }),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    }),
  };
});

describe('getCachedSession', () => {
  it('returns session on first call', async () => {
    const { getCachedSession } = await import('../../src/lib/supabase');
    const session = await getCachedSession();
    expect(session?.access_token).toBe('tok-1');
  });

  it('returns cached session on second call without re-fetching', async () => {
    const { getCachedSession, getSupabase } = await import('../../src/lib/supabase');
    await getCachedSession();
    await getCachedSession();
    expect(getSupabase().auth.getSession).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/supabase-cache.test.ts 2>&1 | tail -10
```
Expected: FAIL — `getCachedSession is not a function`

- [ ] **Step 3: Add `getCachedSession()` to `src/lib/supabase.ts`**

Add after the `getCachedUser()` function (around line 75):

```typescript
let _sessionCache: { session: import('@supabase/supabase-js').Session | null; resolvedAt: number } | null = null;
const SESSION_CACHE_TTL_MS = 30_000;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _sessionCache = null;
  });
}

/**
 * Returns the current session (including access_token) with a short-lived
 * in-memory cache. Use this instead of `getSupabase().auth.getSession()` in
 * Console components that need access_token for Edge Function calls.
 *
 * Safe for concurrent callers — only one getSession() request fires per
 * 30-second window, preventing navigator.lock contention.
 */
export async function getCachedSession() {
  const now = Date.now();
  if (_sessionCache && (now - _sessionCache.resolvedAt) < SESSION_CACHE_TTL_MS) {
    return _sessionCache.session;
  }
  const { data: { session } } = await getSupabase().auth.getSession();
  _sessionCache = { session, resolvedAt: now };
  return session;
}
```

Also add `_sessionCache = null;` inside the existing `onAuthStateChange` listener (in `ensureAuthListener`) so sign-out invalidates both caches:

```typescript
function ensureAuthListener() {
  if (_authListenerAttached) return;
  _authListenerAttached = true;
  getSupabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      _userCache = null;
      _sessionCache = null; // ← add this
    }
  });
}
```

- [ ] **Step 4: Run tests — expect pass**
```bash
cd /home/ubuntu/rastrum && npx vitest run tests/unit/supabase-cache.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**
```bash
git add src/lib/supabase.ts tests/unit/supabase-cache.test.ts
git commit -m "feat(auth): add getCachedSession() — 30s cache for access_token in Console components"
```

---

### Task 2: Migrate Console components (bulk replacement)

**Files:** All Console*.astro + ExportView + console/*.astro

- [ ] **Step 1: Bulk replace `auth.getSession()` with `getCachedSession()` in all console components**

For every file listed in the file map (except SuggestIdModal and CommunityView):

Pattern to replace:
```typescript
// OLD — in <script> blocks
const { data: { session } } = await supabase.auth.getSession();
// or
const { data: { session: s } } = await supabase.auth.getSession();
```

Replace with:
```typescript
const session = await getCachedSession();
```

Then update all references: `session?.access_token` stays the same; `!!session` stays the same.

Add import to each `<script>` block that uses `getCachedSession`:
```typescript
import { getCachedSession } from '../lib/supabase'; // adjust path for console/ subdir
```

Run this script to do the bulk replacement:
```bash
cd /home/ubuntu/rastrum && python3 << 'EOF'
import re, os, glob

files = glob.glob('src/components/Console*.astro') + \
        glob.glob('src/components/console/*.astro') + \
        ['src/components/ExportView.astro']

for path in files:
    with open(path) as f: c = f.read()
    orig = c
    # Replace getSession patterns
    c = re.sub(
        r"const \{ data: \{ session(?:: \w+)? \} \} = await (?:supabase|sb)\.auth\.getSession\(\);",
        "const session = await getCachedSession();",
        c
    )
    # Add import if needed
    if 'getCachedSession' in c and 'import { getCachedSession' not in c and 'getCachedSession }' not in c:
        depth = '../../' if 'src/components/console/' in path else '../'
        c = re.sub(
            r"(import \{ get(?:Supabase|SupabaseUrl)[^}]*\} from '[^']*supabase[^']*';)",
            lambda m: m.group(0) + f"\n  import {{ getCachedSession }} from '{depth}lib/supabase';",
            c, count=1
        )
    if c != orig:
        with open(path, 'w') as f: f.write(c)
        print(f"FIXED: {path}")
EOF
```

- [ ] **Step 2: Fix SuggestIdModal and CommunityView — use getCachedUser() instead**

```bash
cd /home/ubuntu/rastrum && grep -n "getSession\|getUser" src/components/SuggestIdModal.astro src/components/CommunityView.astro | head -10
```

These only use `user.id` — replace with `getCachedUser()` (already imported in CommunityView from the #956 migration; verify SuggestIdModal has the import too).

- [ ] **Step 3: TypeScript check**
```bash
cd /home/ubuntu/rastrum && npx tsc --noEmit 2>&1 | grep -v "huggingface\|onnx-vision\|identify-runners" | grep "error TS" | head -20
```
Fix any errors (common: `session` could be null — add null guard `if (!session) return;`)

- [ ] **Step 4: Run all tests**
```bash
cd /home/ubuntu/rastrum && npx vitest run 2>&1 | tail -15
```

- [ ] **Step 5: Commit**
```bash
git add src/components/
git commit -m "fix(auth): migrate Console components to getCachedSession() — fixes lock contention

Closes #931. All console components now share a single getSession() call
per 30s window instead of each firing independently on mount."
```
