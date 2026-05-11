/**
 * #708 — Full species Pokédex on user profile
 *
 * Tests that:
 * - The profile Pokédex section renders with the expected structure
 *   (collapsible, correct labels, contains the PokedexView wrapper)
 * - The count badge element is present with correct id
 * - The "Pokédex de Especies" / "Species Pokédex" label appears
 *   in both EN and ES based on the lang prop
 *
 * Since we can't do full Astro component rendering in vitest (no Astro runtime),
 * we validate the HTML structure by parsing the raw Astro source and checking
 * the key structural guarantees match what we implemented.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const profileViewSrc = readFileSync(
  resolve(process.cwd(), 'src/components/ProfileView.astro'),
  'utf-8',
);

describe('#708 — Profile Pokédex tab', () => {
  it('imports PokedexView component', () => {
    expect(profileViewSrc).toContain("import PokedexView from './PokedexView.astro'");
  });

  it('contains the profile-pokedex-section id', () => {
    expect(profileViewSrc).toContain('id="profile-pokedex-section"');
  });

  it('has a <details> element for collapsible UX', () => {
    expect(profileViewSrc).toMatch(/<details[^>]*>/);
  });

  it('has a <summary> element for the tab header', () => {
    expect(profileViewSrc).toMatch(/<summary[^>]*>/);
  });

  it('includes the PokedexView in the profile body', () => {
    expect(profileViewSrc).toContain('<PokedexView');
    expect(profileViewSrc).toContain('lang={lang}');
  });

  it('shows ES label "Pokédex de Especies"', () => {
    expect(profileViewSrc).toContain('Pok\u00e9dex de Especies');
  });

  it('shows EN label "Species Pokédex"', () => {
    expect(profileViewSrc).toContain('Species Pok\u00e9dex');
  });

  it('has a count badge element for displaying observed species count', () => {
    expect(profileViewSrc).toContain('id="profile-pdx-count"');
  });

  it('preserves existing ProfilePokedexLink (link-out still present for back-compat)', () => {
    // The link to the full dex page should still exist.
    expect(profileViewSrc).toContain('ProfilePokedexLink');
  });

  it('PokedexView is placed inside a border-separated panel', () => {
    // The PokedexView should be inside a div with border-t styling
    // (visual separator from the summary header).
    const idx = profileViewSrc.indexOf('<PokedexView');
    const before = profileViewSrc.slice(Math.max(0, idx - 200), idx);
    expect(before).toContain('border-t');
  });
});
