import { describe, it, expect } from 'vitest';
import { resolveChromeMode } from '../../src/lib/chrome-mode';

describe('resolveChromeMode — console mode', () => {
  it('returns "console" for /en/console/', () => {
    expect(resolveChromeMode('/en/console/')).toBe('console');
  });
  it('returns "console" for /es/consola/', () => {
    expect(resolveChromeMode('/es/consola/')).toBe('console');
  });
  it('returns "console" for nested console paths', () => {
    expect(resolveChromeMode('/en/console/users/')).toBe('console');
    expect(resolveChromeMode('/es/consola/auditoria/')).toBe('console');
  });
  it('returns "console" with no trailing slash', () => {
    expect(resolveChromeMode('/en/console')).toBe('console');
  });
  it('still returns "app" for /en/profile/', () => {
    expect(resolveChromeMode('/en/profile/')).toBe('app');
  });
  it('still returns "read" for /', () => {
    expect(resolveChromeMode('/')).toBe('read');
  });
});
