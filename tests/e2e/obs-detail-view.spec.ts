import { test, expect } from '@playwright/test';

// PR3 of the obs detail redesign — viewer-only smoke. Asserts the new
// PhotoGallery + two-column layout shell renders correctly when the page
// has photos hydrated via `rastrum:photos-ready`. The page is locale-
// neutral (per CLAUDE.md regression note: there is no /en/share/obs/).
//
// Strategy: instead of depending on a seeded observation in the preview
// database (which would require a fresh fixture wired through Supabase),
// we drive the gallery directly via the public DOM contract:
//   - SSR shell renders an empty `[data-photo-hero]` and `[data-photo-thumbs]`
//   - the page script dispatches `rastrum:photos-ready` with photos
//   - the gallery hydrates and the lightbox responds to thumb clicks
// This validates the component's contract without coupling to a live obs.

const SAMPLE_ID = '00000000-0000-0000-0000-000000000000';

const FIXTURE = [
  { id: 'p-1', url: 'https://placehold.co/800x500/047857/fff.png?text=Photo+1', thumbnail_url: 'https://placehold.co/120x120/047857/fff.png?text=1', caption: null },
  { id: 'p-2', url: 'https://placehold.co/800x500/0d9488/fff.png?text=Photo+2', thumbnail_url: 'https://placehold.co/120x120/0d9488/fff.png?text=2', caption: null },
  { id: 'p-3', url: 'https://placehold.co/800x500/0369a1/fff.png?text=Photo+3', thumbnail_url: 'https://placehold.co/120x120/0369a1/fff.png?text=3', caption: null },
] as const;

async function hydrateGallery(page: import('@playwright/test').Page) {
  await page.evaluate((photos) => {
    // The Supabase load() rejects with "Observation not found" on a junk
    // id, which hides the gallery shell. Force-show the article so the
    // gallery DOM is present, then hydrate it with the fixture photos.
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('err')?.classList.add('hidden');
    document.getElementById('obs')?.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('rastrum:photos-ready', {
      detail: { photos, galleryId: 'obs-detail' },
    }));
  }, FIXTURE as unknown as Record<string, unknown>[]);
}

test.describe('obs detail viewer (PR3)', () => {
  test('hero + thumb strip render after photos-ready hydration', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await hydrateGallery(page);

    const hero = page.locator('[data-photo-hero]');
    await expect(hero).toBeVisible();
    const heroImg = hero.locator('img');
    await expect(heroImg).toHaveAttribute('src', /Photo\+1/);

    // 2 thumbs (photos 2 and 3 — photo 1 is the hero).
    const thumbs = page.locator('[data-photo-thumb]');
    await expect(thumbs).toHaveCount(2);
    await expect(thumbs.first().locator('img')).toHaveAttribute('loading', 'lazy');
  });

  test('lightbox opens on thumb click and closes on Escape', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await hydrateGallery(page);

    const lightbox = page.locator('[data-photo-lightbox]');
    await expect(lightbox).toBeHidden();

    await page.locator('[data-photo-thumb]').first().click();
    await expect(lightbox).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
  });

  test('keyboard navigation walks through photos', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await hydrateGallery(page);

    await page.locator('[data-photo-hero]').click();
    const lightbox = page.locator('[data-photo-lightbox]');
    await expect(lightbox).toBeVisible();
    const lbImg = page.locator('[data-photo-lightbox-img]');
    await expect(lbImg).toHaveAttribute('src', /Photo\+1/);

    await page.keyboard.press('ArrowRight');
    await expect(lbImg).toHaveAttribute('src', /Photo\+2/);
    await page.keyboard.press('ArrowRight');
    await expect(lbImg).toHaveAttribute('src', /Photo\+3/);
    await page.keyboard.press('ArrowLeft');
    await expect(lbImg).toHaveAttribute('src', /Photo\+2/);

    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
  });

  test('mini-map mounts (MapPicker view-mode host present)', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await hydrateGallery(page);
    // The view-mode picker host renders even without coords (it shows the
    // "Location not available" fallback). PR5 wires dynamic hydration via
    // `rastrum:mappicker-set` events.
    await expect(page.locator('#mp-obs-detail')).toHaveCount(1);
  });

  test('mobile: layout stacks (single-column when below md breakpoint)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await hydrateGallery(page);

    await expect(page.locator('[data-photo-hero]')).toBeVisible();
    await expect(page.locator('#mp-obs-detail')).toHaveCount(1);

    // The hero must sit above the map vertically — confirm by comparing y.
    const heroBox = await page.locator('[data-photo-hero]').boundingBox();
    const mapBox = await page.locator('#mp-obs-detail').boundingBox();
    if (!heroBox || !mapBox) throw new Error('expected both bounding boxes');
    expect(heroBox.y).toBeLessThan(mapBox.y);
  });
});
