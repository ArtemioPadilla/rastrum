#!/usr/bin/env tsx
/**
 * scripts/import-wdpa.ts
 * ──────────────────────
 * M-Loc-1: Download WDPA GeoPackage for Mexico (and optionally LATAM), parse
 * features with ogr2ogr, and upsert into public.places as place_type='protected_area'.
 *
 * Usage:
 *   npx tsx scripts/import-wdpa.ts [--dry-run] [--country MEX]
 *
 * Env:
 *   SUPABASE_DB  — postgres:// connection string (required unless --dry-run)
 *
 * Dependencies (Node):
 *   - node-fetch (or native fetch in Node 18+)
 *   - child_process (stdlib)
 *   - fs/path/os (stdlib)
 *
 * System deps:
 *   - gdal-bin (ogr2ogr) — installed in CI via apt-get
 *
 * Output:
 *   Inserted: N  Updated: M  Skipped: K
 *
 * Notes:
 *   - WDPA data is CC BY 4.0 (protectedplanet.net).
 *   - Upsert key: source_id (WDPA_PID). ON CONFLICT updates geometry + name.
 *   - v1: MEX only. v2: extend COUNTRY_CODES list for LATAM.
 */

import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as https from "node:https";
import * as http from "node:http";

// ─── Config ───────────────────────────────────────────────────────────────────

// WDPA bulk download — free shapefile, no API key required (CC BY 4.0)
// The shp_0 archive contains the main polygon layer for all countries.
const WDPA_URL =
  "https://d1gam3xoknrgr2.cloudfront.net/current/WDPA_WDOECM_wdpa_shp_0.zip";

// ISO3 codes to import (v1: Mexico only; expand for LATAM in v2)
const DEFAULT_COUNTRIES = ["MEX"];

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const countryIdx = args.indexOf("--country");
const COUNTRIES: string[] =
  countryIdx !== -1 && args[countryIdx + 1]
    ? [args[countryIdx + 1].toUpperCase()]
    : DEFAULT_COUNTRIES;

console.log(
  `[wdpa-import] countries=${COUNTRIES.join(",")} dry_run=${DRY_RUN}`
);

// ─── DB connection ────────────────────────────────────────────────────────────

const DB_URL = process.env.SUPABASE_DB || process.env.SUPABASE_DB_URL;
if (!DRY_RUN && !DB_URL) {
  console.error(
    "[wdpa-import] ERROR: SUPABASE_DB or SUPABASE_DB_URL env var required (or use --dry-run)"
  );
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string, dedup: string = ""): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) + dedup
  );
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (res) => {
        if (
          res.statusCode === 301 ||
          res.statusCode === 302 ||
          res.statusCode === 307
        ) {
          // Follow redirect
          downloadFile(res.headers.location!, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wdpa-"));
  console.log(`[wdpa-import] workdir: ${tmpDir}`);

  try {
    // 1. Download
    const zipPath = path.join(tmpDir, "wdpa.zip");
    if (DRY_RUN) {
      console.log(`[wdpa-import] DRY RUN: would download ${WDPA_URL}`);
    } else {
      console.log(`[wdpa-import] Downloading WDPA archive...`);
      await downloadFile(WDPA_URL, zipPath);
      console.log(`[wdpa-import] Download complete: ${zipPath}`);
    }

    // 2. Unzip
    const extractDir = path.join(tmpDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });
    if (!DRY_RUN) {
      execSync(`unzip -q "${zipPath}" -d "${extractDir}"`, { stdio: "inherit" });
    } else {
      console.log(`[wdpa-import] DRY RUN: would unzip to ${extractDir}`);
    }

    // 3. Find shapefile or GPKG
    let sourceFile = "";
    if (!DRY_RUN) {
      const gpkgFiles = fs
        .readdirSync(extractDir, { recursive: true })
        .map((f) => String(f))
        .filter((f) => f.endsWith(".gpkg") || f.endsWith(".shp"));
      if (gpkgFiles.length === 0) {
        throw new Error("No .gpkg or .shp found in archive");
      }
      sourceFile = path.join(extractDir, gpkgFiles[0]);
      console.log(`[wdpa-import] Source file: ${sourceFile}`);
    }

    // 4. Convert to GeoJSON with ogr2ogr, filtered by ISO3
    const geoJsonPath = path.join(tmpDir, "wdpa_filtered.geojson");
    const whereClause = COUNTRIES.map((c) => `ISO3='${c}'`).join(" OR ");

    if (!DRY_RUN) {
      console.log(
        `[wdpa-import] Converting to GeoJSON (where: ${whereClause})...`
      );
      const result = spawnSync(
        "ogr2ogr",
        [
          "-f",
          "GeoJSON",
          geoJsonPath,
          sourceFile,
          "-where",
          whereClause,
          "-t_srs",
          "EPSG:4326",
        ],
        { stdio: "inherit" }
      );
      if (result.status !== 0) {
        throw new Error(`ogr2ogr failed with exit code ${result.status}`);
      }
      console.log(`[wdpa-import] GeoJSON written: ${geoJsonPath}`);
    } else {
      console.log(
        `[wdpa-import] DRY RUN: would run ogr2ogr -where "${whereClause}"`
      );
      // Write a minimal test GeoJSON for dry-run validation
      const testGeoJson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              WDPAID: 555705445,
              NAME: "Reserva de la Biosfera Tehuacán-Cuicatlán",
              ISO3: "MEX",
              DESIG_ENG: "Biosphere Reserve",
              STATUS: "Designated",
              GIS_AREA: 490186.89,
            },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-97.7, 18.1],
                  [-97.0, 18.1],
                  [-97.0, 18.8],
                  [-97.7, 18.8],
                  [-97.7, 18.1],
                ],
              ],
            },
          },
        ],
      };
      fs.writeFileSync(geoJsonPath, JSON.stringify(testGeoJson));
      console.log(`[wdpa-import] DRY RUN: wrote test GeoJSON for validation`);
    }

    // 5. Parse and upsert
    const geojson = JSON.parse(fs.readFileSync(geoJsonPath, "utf-8"));
    const features = geojson.features as Array<{
      type: string;
      properties: Record<string, unknown>;
      geometry: object;
    }>;

    console.log(`[wdpa-import] Processing ${features.length} features...`);

    const seenSlugs = new Set<string>();
    let inserted = 0,
      updated = 0,
      skipped = 0;

    for (const feature of features) {
      const props = feature.properties;
      const wdpaId = String(props.WDPAID ?? props.wdpaid ?? "");
      const name = String(props.NAME ?? props.name ?? "").trim();
      const iso3 = String(props.ISO3 ?? props.iso3 ?? "").trim();

      if (!wdpaId || !name) {
        skipped++;
        continue;
      }

      // Build slug (dedup with numeric suffix)
      let baseSlug = slugify(name);
      let slug = baseSlug;
      let dedup = 2;
      while (seenSlugs.has(slug)) {
        slug = `${baseSlug}_${dedup++}`;
      }
      seenSlugs.add(slug);

      const geometryWkt = JSON.stringify(feature.geometry);

      if (DRY_RUN) {
        console.log(
          `  [dry-run] Would upsert: slug=${slug} source_id=${wdpaId} iso3=${iso3}`
        );
        inserted++;
        continue;
      }

      // Upsert via psql
      const sql = `
        INSERT INTO public.places (
          slug, name, place_type, geometry, source, source_id, country_code, updated_at
        )
        VALUES (
          ${quoteSQL(slug)},
          ${quoteSQL(name)},
          'protected_area',
          ST_GeomFromGeoJSON(${quoteSQL(geometryWkt)})::geography,
          'wdpa',
          ${quoteSQL(wdpaId)},
          ${quoteSQL(iso3ToAlpha2(iso3) ?? iso3)},
          now()
        )
        ON CONFLICT (slug) DO UPDATE
          SET geometry   = EXCLUDED.geometry,
              name       = EXCLUDED.name,
              source_id  = EXCLUDED.source_id,
              updated_at = now()
        RETURNING (xmax = 0) AS was_inserted;
      `;

      try {
        const out = execSync(
          `psql ${quoteShell(DB_URL!)} -t -A -c ${quoteShell(sql)}`,
          { encoding: "utf-8", timeout: 30_000 }
        ).trim();
        if (out === "t") inserted++;
        else updated++;
      } catch (err) {
        console.error(`[wdpa-import] Failed for WDPAID=${wdpaId}: ${err}`);
        skipped++;
      }
    }

    console.log(
      `\n[wdpa-import] Done. Inserted: ${inserted}  Updated: ${updated}  Skipped: ${skipped}`
    );
  } finally {
    // Cleanup temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── SQL/shell quoting helpers ────────────────────────────────────────────────

function quoteSQL(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function quoteShell(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Basic ISO3 → ISO2 mapping for common LATAM/MX countries (v1: MEX only needed)
const ISO3_TO_ISO2: Record<string, string> = {
  MEX: "MX",
  GTM: "GT",
  BLZ: "BZ",
  HND: "HN",
  SLV: "SV",
  NIC: "NI",
  CRI: "CR",
  PAN: "PA",
  COL: "CO",
  VEN: "VE",
  ECU: "EC",
  PER: "PE",
  BOL: "BO",
  BRA: "BR",
  PRY: "PY",
  URY: "UY",
  ARG: "AR",
  CHL: "CL",
  CUB: "CU",
  DOM: "DO",
};

function iso3ToAlpha2(iso3: string): string | null {
  return ISO3_TO_ISO2[iso3.toUpperCase()] ?? null;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[wdpa-import] Fatal:", err);
  process.exit(1);
});
