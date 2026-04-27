# Module 05 — Map View

**Version target:** v0.1
**Status:** shipped — MapLibre + clustered observation pins live; pmtiles MX archive hosted on R2 (`PUBLIC_PMTILES_MX_URL`).
**Last verified:** 2026-04-26 — `src/components/ExploreMap.astro` running in production; offline tiles activate when the env var is set.

---

## Overview

Interactive map showing all user observations as pins. Cluster at zoom-out. Tap pin to see observation card. Offline-capable using pmtiles. Base layer: OpenStreetMap. No Mapbox dependency.

---

## Stack

- **MapLibre GL JS** v4 — open-source, no API key, WebGL-accelerated
- **protomaps/pmtiles** — single-file tile format, hosted on Cloudflare R2
- **supercluster** — fast client-side clustering

---

## Map Init

```typescript
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Register pmtiles protocol
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'vector',
        url: 'pmtiles://https://tiles.rastrum.org/tiles/mexico-v1.pmtiles',
      }
    },
    layers: [/* OSM style layers */],
  },
  center: [-96.72, 17.06],  // Oaxaca city default
  zoom: 10,
  attributionControl: false,
});

// Offline fallback: use cached pmtiles from IndexedDB
map.on('error', (e) => {
  if (e.error?.message?.includes('Failed to fetch')) {
    map.setStyle(FALLBACK_MINIMAL_STYLE); // simple polygon style from cached data
  }
});
```

---

## Tile Setup

**Mexico overview (zoom 0–10):** ~250 MB
- Bundled on first install via Service Worker prefetch on WiFi
- Prompted: "Download offline map for Mexico? (250MB, WiFi recommended)"

**Regional chunk (zoom 11–14):** ~20–60 MB per 50km radius
```typescript
async function downloadRegionTiles(center: LngLat, radiusKm: number): Promise<void> {
  const bbox = centerToBbox(center, radiusKm);
  const chunkUrl = `https://tiles.rastrum.org/tiles/chunks/${tileKey(bbox)}.pmtiles`;
  const response = await fetch(chunkUrl);
  const buffer = await response.arrayBuffer();
  // Store in Dexie blob
  await db.mapTiles.put({ key: tileKey(bbox), data: buffer, downloaded_at: new Date().toISOString() });
}
```

---

## Observation Pins

```typescript
// Add observation GeoJSON source
map.addSource('observations', {
  type: 'geojson',
  data: {
    type: 'FeatureCollection',
    features: observations.map(obs => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [obs.location.lng, obs.location.lat] },
      properties: {
        id: obs.id,
        scientific_name: obs.identification.scientific_name,
        kingdom: obs.identification.kingdom,
        confidence: obs.identification.confidence,
        created_at: obs.created_at,
        thumbnail_url: obs.photos[0]?.url,
      }
    }))
  },
  cluster: true,
  clusterMaxZoom: 14,
  clusterRadius: 50,
});

// Cluster circles
map.addLayer({
  id: 'clusters',
  type: 'circle',
  source: 'observations',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': ['step', ['get', 'point_count'], '#10b981', 10, '#059669', 50, '#047857'],
    'circle-radius': ['step', ['get', 'point_count'], 20, 10, 28, 50, 36],
  }
});

// Individual pins (kingdom-colored)
map.addLayer({
  id: 'unclustered-point',
  type: 'circle',
  source: 'observations',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-color': [
      'match', ['get', 'kingdom'],
      'Plantae',  '#16a34a',
      'Animalia', '#dc2626',
      'Fungi',    '#9333ea',
      '#6b7280'
    ],
    'circle-radius': 8,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#ffffff',
  }
});
```

---

## Observation Popup

```typescript
map.on('click', 'unclustered-point', (e) => {
  const props = e.features![0].properties!;
  const coords = (e.features![0].geometry as GeoJSON.Point).coordinates;

  new maplibregl.Popup({ closeButton: false, maxWidth: '280px' })
    .setLngLat(coords as [number, number])
    .setHTML(`
      <div class="p-3">
        ${props.thumbnail_url
          ? `<img src="${props.thumbnail_url}" class="w-full h-28 object-cover rounded-lg mb-2">`
          : ''
        }
        <p class="font-semibold text-sm italic">${props.scientific_name || 'Unknown species'}</p>
        <p class="text-xs text-zinc-500">${formatDate(props.created_at)}</p>
        <a href="/en/observations/${props.id}/" class="text-xs text-emerald-600 font-medium mt-1 block">
          View observation →
        </a>
      </div>
    `)
    .addTo(map);
});
```

---

## Map Controls

```typescript
// Locate me button (custom)
map.addControl(new LocateMeControl(), 'top-right');

// Layer toggle: show/hide by kingdom
map.addControl(new LayerToggleControl(['Plantae', 'Animalia', 'Fungi']), 'top-left');

// Compass
map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: false }));
```

---

## Filters

```typescript
interface MapFilters {
  kingdom?: 'Plantae' | 'Animalia' | 'Fungi' | 'all';
  dateRange?: { from: string; to: string };
  taxon?: string;           // scientific name contains
  onlyMine?: boolean;
  minConfidence?: number;   // 0.0–1.0
}

function applyFilters(filters: MapFilters): void {
  const conditions: maplibregl.FilterSpecification[] = ['all'];

  if (filters.kingdom && filters.kingdom !== 'all') {
    conditions.push(['==', ['get', 'kingdom'], filters.kingdom]);
  }
  if (filters.onlyMine) {
    conditions.push(['==', ['get', 'observer_id'], currentUserId]);
  }
  if (filters.minConfidence) {
    conditions.push(['>=', ['get', 'confidence'], filters.minConfidence]);
  }

  map.setFilter('unclustered-point', conditions);
  map.setFilter('clusters', conditions);
}
```
