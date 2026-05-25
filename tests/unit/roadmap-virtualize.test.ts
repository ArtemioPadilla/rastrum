import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PBI 5.3 (#1193). The roadmap page is Lighthouse's worst dom-size offender
// (2194 elements). This guard asserts the three load-bearing pieces of the
// virtualization implementation in `RoadmapView.astro` stay present so a
// future refactor cannot silently regress dom-size.
const source = readFileSync(
  resolve(__dirname, '../../src/components/RoadmapView.astro'),
  'utf8'
);

describe('RoadmapView virtualization', () => {
  it('uses IntersectionObserver to mount placeholders lazily', () => {
    expect(source).toMatch(/IntersectionObserver/);
  });

  it('marks each lazy placeholder with data-roadmap-item', () => {
    expect(source).toMatch(/data-roadmap-item/);
  });

  it('honours #item-<id> deep links by reading location.hash', () => {
    expect(source).toMatch(/location\.hash/);
  });

  it('renders only the first N items per phase server-side', () => {
    expect(source).toMatch(/EAGER_PER_PHASE/);
  });

  it('embeds lazy-item payload in a single application/json block', () => {
    expect(source).toMatch(/script type="application\/json" data-roadmap-data/);
  });
});
