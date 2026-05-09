#!/usr/bin/env node
/**
 * scripts/inject-version.js
 *
 * Substitutes the __BUILD_VERSION__ placeholder in public/sw.js and
 * public/manifest.webmanifest with the real build version.
 *
 * Run BEFORE `astro build`. The version is read from PUBLIC_VERSION env var
 * (set by the deploy workflow from CalVer), falling back to package.json
 * for local builds.
 *
 * Why placeholders: previously this script overwrote a hardcoded
 * `'rastrum-shell-<version>'` literal in `public/sw.js`. The source therefore
 * lied about deployed state — a maintainer following the cache-bump runbook
 * would edit the literal, see the change in git, and assume it took effect,
 * but CI's inject step overwrote whatever they typed. The placeholder is
 * unambiguous: there is no version string to bump in source.
 *
 * The placeholder is restored after `astro build` by
 * scripts/restore-version-placeholder.js so the working tree stays clean.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const PLACEHOLDER = '__BUILD_VERSION__';

/**
 * Substitute the VERSION literal in sw.js. Throws if the placeholder is
 * missing (means someone removed it — fail loud rather than ship stale).
 * Returns the new source. Pure: no I/O.
 */
export function substituteSwVersion(source, version) {
  const expected = `const VERSION = '${PLACEHOLDER}';`;
  if (!source.includes(expected)) {
    throw new Error(
      `[inject-version] sw.js is missing the placeholder line ` +
      `\`${expected}\`. Did someone bump VERSION manually? ` +
      `See docs/runbooks/sw-cache.md.`
    );
  }
  return source.replace(expected, `const VERSION = 'rastrum-shell-${version}';`);
}

/**
 * Substitute the version field in a parsed manifest object. Throws if the
 * placeholder is missing. Returns the new object. Pure: no I/O.
 */
export function substituteManifestVersion(manifest, version) {
  if (manifest.version !== PLACEHOLDER) {
    throw new Error(
      `[inject-version] manifest.webmanifest "version" is ` +
      `\`${manifest.version}\`, expected \`${PLACEHOLDER}\`. ` +
      `Did someone bump it manually? See docs/runbooks/sw-cache.md.`
    );
  }
  return { ...manifest, version };
}

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = resolve(__dirname, '..');

  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const version = process.env.PUBLIC_VERSION ?? pkg.version;

  const manifestPath = resolve(root, 'public/manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifestNext = substituteManifestVersion(manifest, version);
  writeFileSync(manifestPath, JSON.stringify(manifestNext, null, 2) + '\n');
  console.log(`[inject-version] manifest.webmanifest → ${version}`);

  const swPath = resolve(root, 'public/sw.js');
  const swNext = substituteSwVersion(readFileSync(swPath, 'utf8'), version);
  writeFileSync(swPath, swNext);
  console.log(`[inject-version] sw.js → rastrum-shell-${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(1);
  }
}
