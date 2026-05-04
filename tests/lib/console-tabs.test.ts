import { describe, it, expect } from 'vitest';
import { CONSOLE_TABS, tabsForRoles, rolePillsFor } from '../../src/lib/console-tabs';
import type { UserRole } from '../../src/lib/types';

describe('console-tabs', () => {
  it('declares 41 tabs total (34 + 7 PR16 entity browsers)', () => {
    expect(CONSOLE_TABS).toHaveLength(41);
  });

  it('every tab has a unique id', () => {
    const ids = CONSOLE_TABS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tab routeKey resolves in the routes table', async () => {
    const { routes } = await import('../../src/i18n/utils');
    for (const tab of CONSOLE_TABS) {
      expect(routes).toHaveProperty(tab.routeKey);
    }
  });

  it('admin role has 30 tabs (23 base + 7 PR16 entity browsers)', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'admin')).toHaveLength(30);
  });

  it('PR16 admin entity browsers are all phase-1 and non-stub', () => {
    const PR16_IDS = ['identifications', 'notifications', 'media', 'follows', 'watchlists', 'projects', 'taxon-changes'];
    for (const id of PR16_IDS) {
      const tab = CONSOLE_TABS.find(t => t.id === id);
      expect(tab, `tab ${id} not registered`).toBeDefined();
      expect(tab!.role).toBe('admin');
      expect(tab!.phase).toBe(1);
      expect(tab!.stub).toBeFalsy();
    }
  });

  it('moderator role has 6 tabs', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'moderator')).toHaveLength(6);
  });

  it('expert role has 5 tabs', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'expert')).toHaveLength(5);
  });

  it('researcher role has 0 sidebar tabs (data-access only)', () => {
    expect(CONSOLE_TABS.filter(t => (t.role as string) === 'researcher')).toHaveLength(0);
  });

  it('tabsForRoles filters by activeRole and gates by allRoles', () => {
    const all = new Set<UserRole>(['admin', 'expert']);
    const adminTabs = tabsForRoles('admin', all);
    expect(adminTabs.every(t => t.role === 'admin')).toBe(true);
    expect(adminTabs).toHaveLength(30);
    const moderatorTabs = tabsForRoles('moderator', all);
    expect(moderatorTabs).toHaveLength(0);
  });

  it('rolePillsFor returns roles in canonical order', () => {
    const all = new Set<UserRole>(['expert', 'admin', 'moderator']);
    expect(rolePillsFor(all)).toEqual(['admin', 'moderator', 'expert']);
  });

  it('rolePillsFor excludes researcher (data-access role)', () => {
    const all = new Set<UserRole>(['admin', 'researcher']);
    expect(rolePillsFor(all)).toEqual(['admin']);
  });

  it('every phase-1 tab is non-stub', () => {
    const phase1 = CONSOLE_TABS.filter(t => t.phase === 1);
    expect(phase1.every(t => !t.stub)).toBe(true);
    expect(phase1.length).toBeGreaterThan(0);
  });
});
