import { describe, it, expect } from 'vitest';
import { escapeHtml, entityChipHtml, canonicalEntityUrl } from './chat-bubble-html';

describe('escapeHtml', () => {
  it('escapes the five HTML danger chars', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml(`it's & "ok"`)).toBe('it&#39;s &amp; &quot;ok&quot;');
  });
});

describe('canonicalEntityUrl', () => {
  it('observation → /share/obs/?id=…', () => {
    expect(canonicalEntityUrl('observation', 'abc-123', 'en')).toBe('/share/obs/?id=abc-123');
  });
  it('species EN → /en/species/<id>/', () => {
    expect(canonicalEntityUrl('species', 'magnolia', 'en')).toBe('/en/species/magnolia/');
  });
  it('species ES → /es/especie/<id>/', () => {
    expect(canonicalEntityUrl('species', 'magnolia', 'es')).toBe('/es/especie/magnolia/');
  });
  it('project EN → /en/projects/detail/?slug=…', () => {
    expect(canonicalEntityUrl('project', 'my-anp', 'en')).toContain('/en/projects/detail/?slug=my-anp');
  });
  it('project ES → /es/proyectos/detail/?slug=…', () => {
    expect(canonicalEntityUrl('project', 'my-anp', 'es')).toContain('/es/proyectos/detail/?slug=my-anp');
  });
  it('observer EN → /en/profile/u/<id>/', () => {
    expect(canonicalEntityUrl('observer', 'uid', 'en')).toBe('/en/profile/u/uid/');
  });
  it('self_profile EN → /en/profile/', () => {
    expect(canonicalEntityUrl('self_profile', 'uid', 'en')).toBe('/en/profile/');
  });
});

describe('entityChipHtml', () => {
  it('renders icon, escaped label, link, detach button', () => {
    const html = entityChipHtml({
      kind: 'observation', id: 'abc', label: '<bad>label', icon: '🔍', lang: 'en',
    });
    expect(html).toContain('data-chat-entity-chip');
    expect(html).toContain('🔍');
    expect(html).toContain('&lt;bad&gt;label');  // escaped
    expect(html).toContain('href="/share/obs/?id=abc"');
    expect(html).toContain('data-chip-detach');
  });
});
