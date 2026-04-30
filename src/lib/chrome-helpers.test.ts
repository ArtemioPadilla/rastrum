import { describe, it, expect } from 'vitest';
import { getFabTarget, isActiveSection } from './chrome-helpers';

describe('getFabTarget', () => {
  it('default: any non-observe page → /observe (auth-respecting)', () => {
    expect(getFabTarget('/en/explore/map/', 'en')).toEqual({
      href: '/en/observe/', mode: 'observe',
    });
    expect(getFabTarget('/en/profile/', 'en')).toEqual({
      href: '/en/observe/', mode: 'observe',
    });
    expect(getFabTarget('/es/explorar/', 'es')).toEqual({
      href: '/es/observar/', mode: 'observe',
    });
  });

  it('on /observe (en) → /observe?mode=identify in quick mode', () => {
    expect(getFabTarget('/en/observe/', 'en')).toEqual({
      href: '/en/observe/', mode: 'quick-id',
    });
  });

  it('on /observar (es) → /observar?mode=identify in quick mode', () => {
    expect(getFabTarget('/es/observar/', 'es')).toEqual({
      href: '/es/observar/', mode: 'quick-id',
    });
  });

  it('handles missing trailing slash on observe', () => {
    expect(getFabTarget('/en/observe', 'en').mode).toBe('quick-id');
  });
});

describe('isActiveSection', () => {
  it('observe matches /observe and /observar', () => {
    expect(isActiveSection('/en/observe/', 'observe', 'en')).toBe(true);
    expect(isActiveSection('/es/observar/', 'observe', 'es')).toBe(true);
    expect(isActiveSection('/en/observe', 'observe', 'en')).toBe(true);
  });

  it('explore is active on any /explore subroute', () => {
    expect(isActiveSection('/en/explore/', 'explore', 'en')).toBe(true);
    expect(isActiveSection('/en/explore/map/', 'explore', 'en')).toBe(true);
    expect(isActiveSection('/es/explorar/seguimiento/', 'explore', 'es')).toBe(true);
  });

  it('docs is active on any /docs subroute (both locales share /docs)', () => {
    expect(isActiveSection('/en/docs/', 'docs', 'en')).toBe(true);
    expect(isActiveSection('/en/docs/architecture/', 'docs', 'en')).toBe(true);
    expect(isActiveSection('/es/docs/vision/', 'docs', 'es')).toBe(true);
  });

  it('does not cross-contaminate sections', () => {
    expect(isActiveSection('/en/observe/', 'explore', 'en')).toBe(false);
    expect(isActiveSection('/en/about/', 'docs', 'en')).toBe(false);
  });

  it('home only matches the bare locale path', () => {
    expect(isActiveSection('/en/', 'home', 'en')).toBe(true);
    expect(isActiveSection('/es/', 'home', 'es')).toBe(true);
    expect(isActiveSection('/en/about/', 'home', 'en')).toBe(false);
  });
});
