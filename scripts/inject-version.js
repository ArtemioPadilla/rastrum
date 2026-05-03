#!/usr/bin/env node
/**
 * scripts/inject-version.js
 *
 * Injects the build version into public/manifest.webmanifest and public/sw.js
 * at build time without modifying tracked source files.
 *
 * Run BEFORE `astro build`. The version is read from PUBLIC_VERSION env var
 * (set by the deploy workflow from git), falling back to package.json.
 *
 * Why: manifest.webmanifest and sw.js ship as static assets — they need the
 * version string baked in. The footer reads import.meta.env.PUBLIC_VERSION
 * already; this script keeps the other two in sync automatically.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Resolve version: CI injects PUBLIC_VERSION from git; local dev falls back
// to package.json so the script always produces a valid output.
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = process.env.PUBLIC_VERSION ?? pkg.version;

// ── manifest.webmanifest ──────────────────────────────────────────────────
const manifestPath = resolve(root, 'public/manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[inject-version] manifest.webmanifest → ${version}`);
} else {
  console.log(`[inject-version] manifest.webmanifest already at ${version}`);
}

// ── sw.js ─────────────────────────────────────────────────────────────────
const swPath = resolve(root, 'public/sw.js');
let sw = readFileSync(swPath, 'utf8');
const swVersionLine = `const VERSION = 'rastrum-shell-${version}';`;
const swUpdated = sw.replace(/^const VERSION = .*$/m, swVersionLine);
if (swUpdated !== sw) {
  writeFileSync(swPath, swUpdated);
  console.log(`[inject-version] sw.js → rastrum-shell-${version}`);
} else {
  console.log(`[inject-version] sw.js already at rastrum-shell-${version}`);
}
