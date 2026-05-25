/**
 * PBI 2.1 (#1193) — image-variants URL builder.
 * Pins the AVIF/WebP/multi-width contract so a careless change to the
 * Cloudflare resizing URL shape (or the host allowlist) trips this gate.
 */
import { describe, it, expect } from 'vitest';
import { buildImageVariants, EXPLORE_CARD_SIZES } from '../../src/lib/image-variants';

describe('buildImageVariants', () => {
  it('emits AVIF + WebP srcsets at 320/640/1280 for media.rastrum.org', () => {
    const v = buildImageVariants('https://media.rastrum.org/observations/abc/primary.jpg');
    expect(v.hasVariants).toBe(true);
    expect(v.fallback).toBe('https://media.rastrum.org/observations/abc/primary.jpg');
    expect(v.avifSrcset).toContain('format=avif');
    expect(v.avifSrcset).toContain('width=320');
    expect(v.avifSrcset).toContain('width=640');
    expect(v.avifSrcset).toContain('width=1280');
    expect(v.avifSrcset).toMatch(/ 320w/);
    expect(v.avifSrcset).toMatch(/ 640w/);
    expect(v.avifSrcset).toMatch(/ 1280w/);
    expect(v.webpSrcset).toContain('format=webp');
    expect(v.webpSrcset).toContain('width=320');
    expect(v.webpSrcset).toContain('width=640');
    expect(v.webpSrcset).toContain('width=1280');
  });

  it('rewrites onto the same host via /cdn-cgi/image/ so R2 binding stays intact', () => {
    const v = buildImageVariants('https://media.rastrum.org/observations/abc/primary.jpg');
    // The transform URL stays on media.rastrum.org and contains the option string + origin path.
    expect(v.avifSrcset).toMatch(/^https:\/\/media\.rastrum\.org\/cdn-cgi\/image\//);
    expect(v.avifSrcset).toContain('/observations/abc/primary.jpg');
  });

  it('returns raw URL only for non-resizing hosts (Supabase Storage etc.)', () => {
    const v = buildImageVariants('https://reppvlqejgoqvitturxp.supabase.co/storage/v1/object/public/media/abc.jpg');
    expect(v.hasVariants).toBe(false);
    expect(v.fallback).toBe('https://reppvlqejgoqvitturxp.supabase.co/storage/v1/object/public/media/abc.jpg');
    expect(v.avifSrcset).toBe('');
    expect(v.webpSrcset).toBe('');
  });

  it('returns empty fallback for null/undefined/blank input', () => {
    expect(buildImageVariants(null).fallback).toBe('');
    expect(buildImageVariants(undefined).fallback).toBe('');
    expect(buildImageVariants('').fallback).toBe('');
    expect(buildImageVariants('   ').fallback).toBe('');
    expect(buildImageVariants(null).hasVariants).toBe(false);
  });

  it('does not double-wrap an already-transformed URL', () => {
    const v = buildImageVariants(
      'https://media.rastrum.org/cdn-cgi/image/width=640,format=auto/observations/abc.jpg',
    );
    // Already a /cdn-cgi/image/ URL — treat as opaque, no further rewriting.
    expect(v.hasVariants).toBe(false);
    expect(v.avifSrcset).toBe('');
  });

  it('accepts a custom widths list for tiny thumbnails', () => {
    const v = buildImageVariants('https://media.rastrum.org/observations/abc/primary.jpg', [80, 160]);
    expect(v.avifSrcset).toMatch(/ 80w/);
    expect(v.avifSrcset).toMatch(/ 160w/);
    expect(v.avifSrcset).not.toMatch(/ 320w/);
    expect(v.avifSrcset).not.toMatch(/ 1280w/);
  });

  it('exposes the explore-card sizes attribute', () => {
    expect(EXPLORE_CARD_SIZES).toBe('(max-width: 640px) 100vw, 50vw');
  });
});
