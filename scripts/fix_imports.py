#!/usr/bin/env python3
"""Fix imports: add getCachedUser to all files that use it but don't import it."""

import re
import os

WORKTREE = '/home/ubuntu/rastrum/.worktrees/feat-933/src/components'

def fix_import(content, lib_path):
    import_pattern = re.compile(
        r'(import\s*\{\s*)([^}]+)(\s*\}\s*from\s*[\'\"]' + re.escape(lib_path) + r'[\'\"])'
    )
    match = import_pattern.search(content)
    if not match:
        return content
    items_str = match.group(2)
    items = [x.strip() for x in items_str.split(',') if x.strip()]
    if 'getCachedUser' in items:
        return content  # already there
    items.append('getCachedUser')
    items = sorted(items)
    new_inner = ', '.join(items)
    new_import = match.group(1) + new_inner + ' ' + match.group(3).lstrip()
    return content[:match.start()] + new_import + content[match.end():]

fixed = []
for root, dirs, files in os.walk(WORKTREE):
    dirs.sort()
    for fname in sorted(files):
        if not fname.endswith('.astro'):
            continue
        fpath = os.path.join(root, fname)
        rel = os.path.relpath(fpath, WORKTREE)
        
        with open(fpath) as f:
            content = f.read()
        
        # Only process files that use getCachedUser
        if 'getCachedUser' not in content:
            continue
        
        # Determine lib path
        depth = rel.count('/')
        lib_path = '../../lib/supabase' if depth > 0 else '../lib/supabase'
        
        # Check if import already has getCachedUser
        import_pattern = re.compile(
            r'import\s*\{[^}]+\}\s*from\s*[\'\"]' + re.escape(lib_path) + r'[\'\"]'
        )
        match = import_pattern.search(content)
        if match and 'getCachedUser' not in match.group(0):
            # Needs update
            new_content = fix_import(content, lib_path)
            if new_content != content:
                with open(fpath, 'w') as f:
                    f.write(new_content)
                fixed.append(rel)
                print(f"  FIXED import: {rel}")
        elif not match:
            # No import from supabase lib found — check if dynamic import
            if 'getCachedUser' in content and 'import(' in content and 'supabase' in content:
                print(f"  NOTE: {rel} uses dynamic import, skip")
            elif 'getCachedUser' in content:
                print(f"  WARN: {rel} uses getCachedUser but no import found")

print(f"\nFixed {len(fixed)} imports")
