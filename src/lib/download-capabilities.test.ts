import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_CATALOG,
  degradeCatalog,
  defaultSelection,
  liveTotalMb,
  formatSize,
} from './download-capabilities';

describe('download-capabilities', () => {
  it('default selection is EfficientNet + BirdNET', () => {
    expect(defaultSelection(CAPABILITY_CATALOG)).toEqual(['efficientnet', 'birdnet']);
  });

  it('live total sums selected item sizes', () => {
    expect(liveTotalMb(CAPABILITY_CATALOG, ['efficientnet', 'birdnet'])).toBe(68);
    expect(liveTotalMb(CAPABILITY_CATALOG, ['phi'])).toBe(4096);
    expect(liveTotalMb(CAPABILITY_CATALOG, [])).toBe(0);
  });

  it('formatSize renders MB under 1024 and GB at/over', () => {
    expect(formatSize(68)).toBe('68 MB');
    expect(formatSize(4096)).toBe('4.0 GB');
    expect(formatSize(120)).toBe('120 MB');
  });

  it('degradeCatalog with no available targets keeps only offline-map', () => {
    const kept = degradeCatalog(CAPABILITY_CATALOG, new Set());
    expect(kept.map((c) => c.id)).toEqual(['offline-map']);
  });

  it('degradeCatalog keeps an available target plus offline-map', () => {
    const kept = degradeCatalog(CAPABILITY_CATALOG, new Set(['onnx_efficientnet_lite0']));
    expect(kept.map((c) => c.id).sort()).toEqual(['efficientnet', 'offline-map']);
  });

  it('every advanced item is default-unchecked', () => {
    for (const c of CAPABILITY_CATALOG) {
      if (c.advanced) expect(c.defaultChecked).toBe(false);
    }
  });

  it('every catalog id is unique', () => {
    const ids = CAPABILITY_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('EfficientNet + BirdNET are the only non-advanced default-checked items', () => {
    const defaults = CAPABILITY_CATALOG.filter((c) => c.defaultChecked);
    expect(defaults.every((c) => !c.advanced)).toBe(true);
    expect(defaults.map((c) => c.id).sort()).toEqual(['birdnet', 'efficientnet']);
  });
});
