#!/usr/bin/env node
import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'audit-screenshots');
await mkdir(OUT, { recursive: true });

const ROUTES = [
  // Public marketing + landing
  { path: '/',                          name: '00-locale-picker' },
  { path: '/en/',                       name: '01-home-en' },
  { path: '/es/',                       name: '02-home-es' },
  { path: '/en/about/',                 name: '03-about-en' },
  { path: '/es/acerca/',                name: '04-about-es' },
  // Core action
  { path: '/en/observe/',               name: '10-observe-en' },
  { path: '/es/observar/',              name: '11-observe-es' },
  { path: '/en/observe/?onb=demo',      name: '12-observe-demo' },
  // Explore + discovery
  { path: '/en/explore/',               name: '20-explore-en' },
  { path: '/en/explore/map/',           name: '21-explore-map' },
  { path: '/en/explore/recent/',        name: '22-explore-recent' },
  { path: '/en/explore/species/',       name: '23-explore-species' },
  { path: '/en/explore/watchlist/',     name: '24-explore-watchlist' },
  { path: '/en/community/observers/',   name: '25-community-observers' },
  { path: '/en/community/leaderboard/', name: '26-community-leaderboard' },
  // Chat + Docs
  { path: '/en/chat/',                  name: '30-chat' },
  { path: '/en/docs/',                  name: '31-docs-index' },
  { path: '/en/docs/vision/',           name: '32-docs-vision' },
  { path: '/en/docs/roadmap/',          name: '33-docs-roadmap' },
  // Auth + profile
  { path: '/en/sign-in/',               name: '40-sign-in' },
  { path: '/es/ingresar/',              name: '41-ingresar' },
  { path: '/en/profile/',               name: '42-profile' },
  { path: '/en/profile/dex/',           name: '43-profile-dex' },
  { path: '/en/profile/edit/',          name: '44-profile-edit' },
  // Console (signed in but the page itself loads chrome)
  { path: '/en/console/',               name: '50-console' },
  { path: '/en/console/health/',        name: '51-console-health' },
  // Identify standalone
  { path: '/en/identify/',              name: '60-identify' },
];

async function screenshot(browser, viewport, route, suffix) {
  const ctx = await browser.newContext({
    viewport: viewport.viewport,
    userAgent: viewport.userAgent,
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  const page = await ctx.newPage();
  const url = `http://localhost:4329${route.path}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e) {
    console.warn(`  ! ${route.name}/${suffix} navigation issue: ${e.message?.substring(0, 80)}`);
  }
  // Settle anims/animations
  await page.waitForTimeout(800);
  const file = `${OUT}/${route.name}.${suffix}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${route.name}.${suffix}.png`);
  await ctx.close();
}

const browser = await chromium.launch();

const viewports = [
  { name: 'desktop', viewport: { width: 1366, height: 800 }, userAgent: undefined },
  { name: 'mobile',  ...devices['iPhone 13'] },
];

for (const route of ROUTES) {
  console.log(`→ ${route.path}`);
  for (const vp of viewports) {
    await screenshot(browser, vp, route, vp.name);
  }
}

await browser.close();
console.log(`\nDone. ${ROUTES.length * 2} screenshots in ${OUT}/`);
