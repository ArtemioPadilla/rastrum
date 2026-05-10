#!/usr/bin/env python3
"""
Migrate auth.getUser() / auth.getSession() to getCachedUser() in Rastrum components.
Only replaces auth-check calls, not calls that fetch session tokens for API requests.
"""

import re
import os

WORKTREE = '/home/ubuntu/rastrum/.worktrees/feat-933/src/components'

# These files use access_token from getSession() — keep them as-is
ACCESS_TOKEN_FILES = {
    'ConsoleAnomaliesView.astro',
    'ConsoleAppealsView.astro',
    'ConsoleBadgesView.astro',
    'ConsoleErrorsView.astro',
    'ConsoleForensicsView.astro',
    'ConsoleHealthView.astro',
    'ConsoleProposalsView.astro',
    'ConsoleTaxaView.astro',
    'ConsoleWebhooksView.astro',
    'ConsoleFeatureFlagsView.astro',
    'ConsoleSlideOver.astro',
    'ConsoleCredentialsView.astro',
    'ConsoleBansView.astro',
    'ConsoleCommentsView.astro',
    'ConsoleFlagQueueView.astro',
    'ConsoleObservationsView.astro',
    'ConsoleUsersView.astro',
    # These need full session for access_token
    'console/PlantNetQuotaPanel.astro',
    'console/ExpertApplicationsBrowser.astro',
}

# Files that use dynamic import or have special session handling — handle manually
MANUAL_FILES = {
    'SurprisesPrefsSection.astro',   # dynamic import, different pattern
    'PoolDonateView.astro',           # dynamic import
    'SponsorshipBanner.astro',        # uses .data.session for full session check
    'KarmaLeaderboardView.astro',     # complex session patterns
    'MyObservationsView.astro',       # explicit getUser() with timeout + getSession() guard
    'SignInForm.astro',               # getSession to check redirect - needs session.user
    'Header.astro',                   # getSession + onAuthStateChange pattern
    'MobileBottomBar.astro',          # getSession + onAuthStateChange pattern
    'MobileDrawer.astro',             # getSession + onAuthStateChange pattern
    'ExploreRecentView.astro',        # const { data } pattern with viewerAuthed
    'ExpertiseCoverageGrid.astro',    # const { data } pattern, optional userId
    'ExpertiseLegendBadge.astro',     # const { data } pattern, optional userId
    'ChatEntityPicker.astro',         # me.data?.user pattern
    'InboxView.astro',                # mixed: line 347 + 434
    'NotificationPrefsView.astro',    # sb.auth.getUser() (not supabase/sb standard)
    'OnboardingTour.astro',           # sb.auth.getUser()
    'ProjectDetailView.astro',        # sb.auth.getSession()
    'ProjectNewView.astro',           # sb.auth.getSession()
    'ProjectsListView.astro',         # sb.auth.getSession()
    'SuggestIdModal.astro',           # Promise.all pattern
    'BellIcon.astro',                 # getSession -> session?.user pattern
    'CommunityView.astro',            # getSupabase().auth.getUser() inside try/catch
    'ExportView.astro',               # mixed: getUser() at top + getSession() for token
    'PrivacyMatrix.astro',            # getUser() + getSession() for access_token below
}

def update_imports(content, lib_path):
    """Add getCachedUser to existing import statement."""
    if 'getCachedUser' in content:
        return content
    
    # Match existing import from supabase lib
    import_pattern = re.compile(
        r"(import\s*\{\s*)([^}]+)(\s*\}\s*from\s*['\"]" + re.escape(lib_path) + r"['\"])"
    )
    match = import_pattern.search(content)
    if match:
        items_str = match.group(2)
        items = [x.strip() for x in items_str.split(',') if x.strip()]
        if 'getCachedUser' not in items:
            items.append('getCachedUser')
            items = sorted(items)
        new_inner = ', '.join(items)
        new_import = match.group(1) + new_inner + match.group(3)
        content = content[:match.start()] + new_import + content[match.end():]
    return content

def process_standard_file(fpath, lib_path):
    """Process files with standard patterns."""
    with open(fpath) as f:
        content = f.read()
    
    original = content
    
    # Pattern 1: const { data: { user } } = await supabase.auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user \} \} = await (?:supabase|sb)\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    
    # Pattern 1b: const { data: { user: viewer } } = await supabase.auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user: (\w+) \} \} = await (?:supabase|sb)\.auth\.getUser\(\);',
        lambda m: f'const {m.group(1)} = await getCachedUser();',
        content
    )
    
    # Pattern 1c: const { data: { user } } = await getSupabase().auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user \} \} = await getSupabase\(\)\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    
    # Pattern 2: getSession → user check (console pattern)
    # const { data: { session } } = await supabase.auth.getSession();
    # → const user = await getCachedUser();
    content = re.sub(
        r'const \{ data: \{ session \} \} = await (?:supabase|sb)\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    # Replace session null/undefined checks
    content = re.sub(r'if \(!session\)', 'if (!user)', content)
    content = re.sub(r'if \(!session\?\.user\)', 'if (!user)', content)
    # Replace session.user.id and session.user references
    content = content.replace('session.user.id', 'user.id')
    content = content.replace('session.user', 'user')
    content = content.replace('session?.user', 'user')
    
    # Pattern 3: getSupabase().auth.getSession() (non-standard client var)
    content = re.sub(
        r'const \{ data: \{ session \} \} = await getSupabase\(\)\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    
    if content == original:
        return False, None
    
    content = update_imports(content, lib_path)
    return True, content


# ===== Manual file handlers =====

def handle_BellIcon(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await supabase.auth.getSession();
    # const user = session?.user ?? null;
    content = content.replace(
        "const { data: { session } } = await supabase.auth.getSession();\n      const user = session?.user ?? null;",
        "const user = await getCachedUser();"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_CommunityView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    content = re.sub(
        r'const \{ data: \{ user \} \} = await getSupabase\(\)\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ChatEntityPicker(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const me = await sb.auth.getUser();
    # if (me.data?.user) rows = [{ id: me.data.user.id, ... }];
    content = content.replace(
        "const me = await sb.auth.getUser();\n        if (me.data?.user) rows = [{ id: me.data.user.id,",
        "const me = await getCachedUser();\n        if (me) rows = [{ id: me.id,"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ExploreRecentView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data } = await supabase.auth.getUser();
    # viewerAuthed = !!data.user;
    # viewerId = data.user?.id ?? null;
    content = content.replace(
        "const { data } = await supabase.auth.getUser();\n      viewerAuthed = !!data.user;\n      viewerId = data.user?.id ?? null;",
        "const _viewer = await getCachedUser();\n      viewerAuthed = !!_viewer;\n      viewerId = _viewer?.id ?? null;"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ExpertiseCoverageGrid(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data } = await getSupabase().auth.getUser();
    # userId = data.user?.id ?? '';
    content = content.replace(
        "const { data } = await getSupabase().auth.getUser();\n      userId = data.user?.id ?? '';",
        "const _authUser = await getCachedUser();\n      userId = _authUser?.id ?? '';"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ExpertiseLegendBadge(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data } = await getSupabase().auth.getUser();
    # userId = data.user?.id ?? '';
    content = content.replace(
        "const { data } = await getSupabase().auth.getUser();\n      userId = data.user?.id ?? '';",
        "const _authUser = await getCachedUser();\n      userId = _authUser?.id ?? '';"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_InboxView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Line 347: const { data: { user } } = await supabase.auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    # Line 434: const { data: { user: me } } = await sb.auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user: me \} \} = await sb\.auth\.getUser\(\);',
        'const me = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_NotificationPrefsView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { user } } = await sb.auth.getUser();
    content = re.sub(
        r'const \{ data: \{ user \} \} = await sb\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_OnboardingTour(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    content = re.sub(
        r'const \{ data: \{ user \} \} = await sb\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ProjectDetailView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await sb.auth.getSession();
    # if (!session) { ... } (no access_token usage)
    content = re.sub(
        r'const \{ data: \{ session \} \} = await sb\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    content = re.sub(r'if \(!session\)', 'if (!user)', content)
    content = content.replace('session.user.id', 'user.id')
    content = content.replace('session.user', 'user')
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ProjectNewView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    content = re.sub(
        r'const \{ data: \{ session \} \} = await sb\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    content = re.sub(r'if \(!session\)', 'if (!user)', content)
    content = content.replace('session.user.id', 'user.id')
    content = content.replace('session.user', 'user')
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ProjectsListView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    content = re.sub(
        r'const \{ data: \{ session \} \} = await sb\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    content = re.sub(r'if \(!session\)', 'if (!user)', content)
    content = content.replace('session.user.id', 'user.id')
    content = content.replace('session.user', 'user')
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_SuggestIdModal(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Line 140: supabase.auth.getUser() inside Promise.all
    # Line 291: const { data: { user } } = await supabase.auth.getUser();
    # Line 140 is inside a Promise.all — keep as-is (it's an optimization not an auth check)
    # But line 291 is a simple auth check
    content = re.sub(
        r'const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_ExportView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Lines 100, 122: simple auth checks → getCachedUser
    # Line 206: getSession() for access_token → keep
    content = re.sub(
        r'const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_PrivacyMatrix(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Line 225: const { data: { user } } = await supabase.auth.getUser();
    # (access_token used elsewhere via getSession — not replacing those)
    content = re.sub(
        r'const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);',
        'const user = await getCachedUser();',
        content
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_Header(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await getSupabase().auth.getSession();
    # await paint(!!session, session?.user as Parameters<typeof paint>[1]);
    # if (session?.user) await maybeShowConsolePill(session.user.id);
    content = content.replace(
        "const { data: { session } } = await getSupabase().auth.getSession();\n      await paint(!!session, session?.user as Parameters<typeof paint>[1]);\n      if (session?.user) await maybeShowConsolePill(session.user.id);",
        "const user = await getCachedUser();\n      await paint(!!user, user as Parameters<typeof paint>[1]);\n      if (user) await maybeShowConsolePill(user.id);"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_MobileBottomBar(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await getSupabase().auth.getSession();
    # paint(!!session);
    content = re.sub(
        r'const \{ data: \{ session \} \} = await getSupabase\(\)\.auth\.getSession\(\);',
        'const user = await getCachedUser();',
        content
    )
    content = content.replace('paint(!!session)', 'paint(!!user)')
    content = content.replace('session', 'user')  # remaining refs
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_MobileDrawer(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await getSupabase().auth.getSession();
    # paintAuth(!!session);
    # if (session?.user) await maybeShowConsoleLink(session.user.id);
    content = content.replace(
        "const { data: { session } } = await getSupabase().auth.getSession();\n      paintAuth(!!session);\n      if (session?.user) await maybeShowConsoleLink(session.user.id);",
        "const user = await getCachedUser();\n      paintAuth(!!user);\n      if (user) await maybeShowConsoleLink(user.id);"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_KarmaLeaderboardView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Line 450: const { data: sessionData } = await supabase.auth.getSession();
    # const userId = sessionData?.session?.user?.id;
    content = content.replace(
        "const { data: sessionData } = await supabase.auth.getSession();\n      const userId = sessionData?.session?.user?.id;",
        "const _karmaUser = await getCachedUser();\n      const userId = _karmaUser?.id;"
    )
    # Line 801: getCurrentUserId function
    # const { data } = await supabase.auth.getSession();
    # return data.session?.user?.id ?? null;
    content = content.replace(
        "const { data } = await supabase.auth.getSession();\n      return data.session?.user?.id ?? null;",
        "const _user = await getCachedUser();\n      return _user?.id ?? null;"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_MyObservationsView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Line 853: const { data: { session } } = await supabase.auth.getSession();
    # Line 863: const userPromise = supabase.auth.getUser(); (intentional timeout pattern, keep)
    # Replace only the getSession guard at top, keep the getUser with timeout
    content = content.replace(
        "const { data: { session } } = await supabase.auth.getSession();\n    if (!session) {",
        "const _session_user = await getCachedUser();\n    if (!_session_user) {"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_SignInForm(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # const { data: { session } } = await getSupabase().auth.getSession();
    # if (session?.user) { window.location.replace(...) }
    content = content.replace(
        "const { data: { session } } = await getSupabase().auth.getSession();\n      if (session?.user) {",
        "const user = await getCachedUser();\n      if (user) {"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

def handle_SurprisesPrefsSection(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Dynamic import: const { getSupabase } = await import('../lib/supabase.ts');
    # const supabase = getSupabase();
    # const { data: { session } } = await supabase.auth.getSession();
    # if (!session?.user?.id) { ... }
    # const userId = session.user.id;
    content = content.replace(
        "const { getSupabase } = await import('../lib/supabase.ts');\n    const supabase = getSupabase();\n    const { data: { session } } = await supabase.auth.getSession();\n    if (!session?.user?.id) {",
        "const { getSupabase, getCachedUser } = await import('../lib/supabase.ts');\n    const supabase = getSupabase();\n    const user = await getCachedUser();\n    if (!user?.id) {"
    )
    content = content.replace("const userId = session.user.id;", "const userId = user.id;")
    if content == original:
        return False, None
    # Don't call update_imports for dynamic import files
    return True, content

def handle_PoolDonateView(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # Dynamic import: const { getSupabase } = await import('../lib/supabase');
    # const { data: { session } } = await getSupabase().auth.getSession();
    # if (!session) { ... }
    content = content.replace(
        "const { getSupabase } = await import('../lib/supabase');\n    const { data: { session } } = await getSupabase().auth.getSession();\n\n    if (!session) {",
        "const { getSupabase, getCachedUser } = await import('../lib/supabase');\n    const user = await getCachedUser();\n\n    if (!user) {"
    )
    if content == original:
        return False, None
    return True, content

def handle_SponsorshipBanner(fpath, lib_path):
    with open(fpath) as f:
        content = f.read()
    original = content
    # let supabaseSession;
    # try { supabaseSession = (await getSupabase().auth.getSession()).data.session; }
    # catch { return; }
    # if (!supabaseSession) return;
    # This checks for full session - replace with getCachedUser
    content = content.replace(
        "let supabaseSession;\n    try { supabaseSession = (await getSupabase().auth.getSession()).data.session; }\n    catch { return; }\n    if (!supabaseSession) return;",
        "const supabaseUser = await getCachedUser().catch(() => null);\n    if (!supabaseUser) return;"
    )
    if content == original:
        return False, None
    content = update_imports(content, lib_path)
    return True, content

# Map of manual handlers
MANUAL_HANDLERS = {
    'BellIcon.astro': handle_BellIcon,
    'CommunityView.astro': handle_CommunityView,
    'ChatEntityPicker.astro': handle_ChatEntityPicker,
    'ExploreRecentView.astro': handle_ExploreRecentView,
    'ExpertiseCoverageGrid.astro': handle_ExpertiseCoverageGrid,
    'ExpertiseLegendBadge.astro': handle_ExpertiseLegendBadge,
    'InboxView.astro': handle_InboxView,
    'NotificationPrefsView.astro': handle_NotificationPrefsView,
    'OnboardingTour.astro': handle_OnboardingTour,
    'ProjectDetailView.astro': handle_ProjectDetailView,
    'ProjectNewView.astro': handle_ProjectNewView,
    'ProjectsListView.astro': handle_ProjectsListView,
    'SuggestIdModal.astro': handle_SuggestIdModal,
    'ExportView.astro': handle_ExportView,
    'PrivacyMatrix.astro': handle_PrivacyMatrix,
    'Header.astro': handle_Header,
    'MobileBottomBar.astro': handle_MobileBottomBar,
    'MobileDrawer.astro': handle_MobileDrawer,
    'KarmaLeaderboardView.astro': handle_KarmaLeaderboardView,
    'MyObservationsView.astro': handle_MyObservationsView,
    'SignInForm.astro': handle_SignInForm,
    'SurprisesPrefsSection.astro': handle_SurprisesPrefsSection,
    'PoolDonateView.astro': handle_PoolDonateView,
    'SponsorshipBanner.astro': handle_SponsorshipBanner,
}

changed = []
skipped = []
errors = []

for root, dirs, files in os.walk(WORKTREE):
    dirs.sort()
    for fname in sorted(files):
        if not fname.endswith('.astro'):
            continue
        fpath = os.path.join(root, fname)
        rel = os.path.relpath(fpath, WORKTREE)
        
        # Check access_token skip list
        skip = False
        for skip_file in ACCESS_TOKEN_FILES:
            if rel == skip_file:
                skip = True
                break
        if skip:
            skipped.append(rel)
            continue
        
        # Check if has auth calls
        with open(fpath) as f:
            content = f.read()
        if 'auth.getUser()' not in content and 'auth.getSession()' not in content:
            continue
        
        # Determine lib path
        depth = rel.count('/')
        lib_path = '../../lib/supabase' if depth > 0 else '../lib/supabase'
        
        try:
            # Use manual handler if available
            if fname in MANUAL_HANDLERS:
                modified, new_content = MANUAL_HANDLERS[fname](fpath, lib_path)
            else:
                modified, new_content = process_standard_file(fpath, lib_path)
            
            if modified and new_content:
                with open(fpath, 'w') as f:
                    f.write(new_content)
                changed.append(rel)
                print(f"  CHANGED: {rel}")
            elif 'auth.getUser()' in content or 'auth.getSession()' in content:
                print(f"  WARN: {rel} has auth calls but no change made")
        except Exception as e:
            errors.append((rel, str(e)))
            print(f"  ERROR: {rel}: {e}", flush=True)
            import traceback
            traceback.print_exc()

print(f"\nSummary:")
print(f"  Changed: {len(changed)}")
print(f"  Skipped (access_token): {len(skipped)}")
print(f"  Errors: {len(errors)}")
if errors:
    for f, e in errors:
        print(f"    ERROR: {f}: {e}")
