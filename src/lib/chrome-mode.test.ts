import { describe, it, expect, afterEach } from 'vitest';
import { resolveChromeMode } from './chrome-mode';

describe('resolveChromeMode', () => {
  it('home is read-mode', () => {
    expect(resolveChromeMode('/en/')).toBe('read');
    expect(resolveChromeMode('/es/')).toBe('read');
  });

  it('observe is app-mode (en + es)', () => {
    expect(resolveChromeMode('/en/observe/')).toBe('app');
    expect(resolveChromeMode('/es/observar/')).toBe('app');
  });

  it('explore and its subroutes are app-mode', () => {
    expect(resolveChromeMode('/en/explore/')).toBe('app');
    expect(resolveChromeMode('/en/explore/map/')).toBe('app');
    expect(resolveChromeMode('/en/explore/recent/')).toBe('app');
    expect(resolveChromeMode('/es/explorar/')).toBe('app');
    expect(resolveChromeMode('/es/explorar/seguimiento/')).toBe('app');
  });

  it('chat is app-mode', () => {
    expect(resolveChromeMode('/en/chat/')).toBe('app');
    expect(resolveChromeMode('/es/chat/')).toBe('app');
  });

  it('profile and its subroutes are app-mode', () => {
    expect(resolveChromeMode('/en/profile/')).toBe('app');
    expect(resolveChromeMode('/en/profile/observations/')).toBe('app');
    expect(resolveChromeMode('/en/profile/settings/profile/')).toBe('app');
    expect(resolveChromeMode('/es/perfil/')).toBe('app');
    expect(resolveChromeMode('/es/perfil/exportar/')).toBe('app');
  });

  it('auth callback is app-mode (no chrome distractions)', () => {
    expect(resolveChromeMode('/auth/callback/')).toBe('app');
  });

  it('identify, about, docs, share are read-mode', () => {
    expect(resolveChromeMode('/en/identify/')).toBe('read');
    expect(resolveChromeMode('/es/identificar/')).toBe('read');
    expect(resolveChromeMode('/en/about/')).toBe('read');
    expect(resolveChromeMode('/es/acerca/')).toBe('read');
    expect(resolveChromeMode('/en/docs/')).toBe('read');
    expect(resolveChromeMode('/en/docs/architecture/')).toBe('read');
    expect(resolveChromeMode('/share/obs/abc123/')).toBe('read');
  });

  it('unknown paths default to read', () => {
    expect(resolveChromeMode('/something/totally/new/')).toBe('read');
    expect(resolveChromeMode('')).toBe('read');
  });

  it('handles missing trailing slash', () => {
    expect(resolveChromeMode('/en/observe')).toBe('app');
    expect(resolveChromeMode('/en/about')).toBe('read');
  });
});

describe('resolveChromeMode with BASE_URL=/rastrum/', () => {
  afterEach(() => {
    // nothing to tear down — baseUrl is passed explicitly
  });

  it('observe under base is app-mode', () => {
    expect(resolveChromeMode('/rastrum/en/observe/', '/rastrum/')).toBe('app');
  });

  it('observe (es) under base is app-mode', () => {
    expect(resolveChromeMode('/rastrum/es/observar/', '/rastrum/')).toBe('app');
  });

  it('docs under base is read-mode', () => {
    expect(resolveChromeMode('/rastrum/en/docs/', '/rastrum/')).toBe('read');
  });

  it('auth callback under base is app-mode', () => {
    expect(resolveChromeMode('/rastrum/auth/callback/', '/rastrum/')).toBe('app');
  });

  it('home under base is read-mode', () => {
    expect(resolveChromeMode('/rastrum/en/', '/rastrum/')).toBe('read');
  });
});
