/**
 * Playwright auth fixtures — inject mock Supabase sessions into localStorage
 * so journey tests can exercise authenticated flows against the static
 * preview server without a real backend.
 *
 * Usage:
 *   import { test } from './fixtures/auth';
 *   test('my journey', async ({ authedPage }) => { ... });
 */
import { test as base, type Page } from '@playwright/test';

interface MockProfile {
  userId?: string;
  email?: string;
  displayName?: string;
  username?: string;
  role?: string;
  is_expert?: boolean;
  expert_taxa?: string[];
  is_admin?: boolean;
  is_moderator?: boolean;
}

async function injectMockSession(page: Page, profile: MockProfile): Promise<void> {
  await page.addInitScript((p: MockProfile) => {
    const session = {
      access_token: 'mock-jwt-for-e2e',
      refresh_token: 'mock-refresh',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: p.userId ?? 'e2e-user-00000000-0000-0000-0000-000000000001',
        email: p.email ?? 'e2e@rastrum.test',
        role: 'authenticated',
        aud: 'authenticated',
        user_metadata: {
          display_name: p.displayName ?? 'E2E Test User',
          username: p.username ?? 'e2e_tester',
          is_expert: p.is_expert ?? false,
          expert_taxa: p.expert_taxa ?? [],
          is_admin: p.is_admin ?? (p.role === 'admin'),
          is_moderator: p.is_moderator ?? (p.role === 'moderator'),
        },
      },
    };
    const key = 'sb-reppvlqejgoqvitturxp-auth-token';
    localStorage.setItem(key, JSON.stringify(session));
  }, profile);
}

type AuthFixtures = {
  authedPage: Page;
  expertPage: Page;
  adminPage: Page;
  modPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await injectMockSession(page, { role: 'authenticated' });
    await use(page);
  },
  expertPage: async ({ page }, use) => {
    await injectMockSession(page, {
      role: 'authenticated',
      is_expert: true,
      expert_taxa: ['Plantae', 'Fungi'],
    });
    await use(page);
  },
  adminPage: async ({ page }, use) => {
    await injectMockSession(page, { role: 'admin', is_admin: true });
    await use(page);
  },
  modPage: async ({ page }, use) => {
    await injectMockSession(page, { role: 'moderator', is_moderator: true });
    await use(page);
  },
});

export { expect } from '@playwright/test';
export { injectMockSession };
export type { MockProfile };
