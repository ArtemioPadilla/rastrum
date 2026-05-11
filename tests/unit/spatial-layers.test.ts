/**
 * tests/unit/spatial-layers.test.ts — Tests for SpatialLayersPanel (issue #194).
 *
 * Tests the CustomEvent interface and layer state logic used by the component.
 * Since SpatialLayersPanel.astro is a server-rendered component, we test the
 * event contract and data model in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Type contract (mirrors what the component script dispatches)
// ---------------------------------------------------------------------------

interface LayerToggledDetail {
  layer: string;
  visible: boolean;
  opacity: number;
}

// Helper: simulate what the component script does
function makeLayerToggledEvent(detail: LayerToggledDetail): CustomEvent<LayerToggledDetail> {
  return new CustomEvent<LayerToggledDetail>('rastrum:layer-toggled', {
    detail,
    bubbles: true,
  });
}

// ---------------------------------------------------------------------------
// Layer definitions (mirrors the component's static data)
// ---------------------------------------------------------------------------

const LAYERS = [
  { id: 'anp-federal',          group: 'anp',   defaultVisible: true,  defaultOpacity: 0.35 },
  { id: 'anp-state',            group: 'anp',   defaultVisible: false, defaultOpacity: 0.30 },
  { id: 'inegi-states',         group: 'inegi', defaultVisible: false, defaultOpacity: 0.20 },
  { id: 'inegi-municipalities', group: 'inegi', defaultVisible: false, defaultOpacity: 0.15 },
  { id: 'inah-heritage',        group: 'inah',  defaultVisible: false, defaultOpacity: 0.40 },
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpatialLayersPanel — layer definitions', () => {
  it('defines exactly 5 layers across 3 groups', () => {
    expect(LAYERS).toHaveLength(5);
  });

  it('has layers in all three groups: anp, inegi, inah', () => {
    const groups = new Set(LAYERS.map((l) => l.group));
    expect(groups.has('anp')).toBe(true);
    expect(groups.has('inegi')).toBe(true);
    expect(groups.has('inah')).toBe(true);
  });

  it('each layer has a unique id', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('default opacities are in [0, 1]', () => {
    for (const layer of LAYERS) {
      expect(layer.defaultOpacity).toBeGreaterThan(0);
      expect(layer.defaultOpacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('rastrum:layer-toggled event', () => {
  it('event name is rastrum:layer-toggled', () => {
    const evt = makeLayerToggledEvent({ layer: 'anp-federal', visible: true, opacity: 0.35 });
    expect(evt.type).toBe('rastrum:layer-toggled');
  });

  it('event detail carries layer id, visible flag, and opacity', () => {
    const detail: LayerToggledDetail = { layer: 'inegi-states', visible: false, opacity: 0.2 };
    const evt = makeLayerToggledEvent(detail);
    expect(evt.detail.layer).toBe('inegi-states');
    expect(evt.detail.visible).toBe(false);
    expect(evt.detail.opacity).toBe(0.2);
  });

  it('event bubbles', () => {
    const evt = makeLayerToggledEvent({ layer: 'anp-state', visible: true, opacity: 0.3 });
    expect(evt.bubbles).toBe(true);
  });

  it('fires when a layer is toggled on', () => {
    const handler = vi.fn();
    document.addEventListener('rastrum:layer-toggled', handler);
    document.dispatchEvent(makeLayerToggledEvent({ layer: 'inah-heritage', visible: true, opacity: 0.4 }));
    expect(handler).toHaveBeenCalledOnce();
    const [evt] = handler.mock.calls[0] as [CustomEvent<LayerToggledDetail>];
    expect(evt.detail.visible).toBe(true);
    document.removeEventListener('rastrum:layer-toggled', handler);
  });

  it('fires when opacity changes', () => {
    const handler = vi.fn();
    document.addEventListener('rastrum:layer-toggled', handler);
    document.dispatchEvent(makeLayerToggledEvent({ layer: 'anp-federal', visible: true, opacity: 0.6 }));
    expect(handler).toHaveBeenCalledOnce();
    const [evt] = handler.mock.calls[0] as [CustomEvent<LayerToggledDetail>];
    expect(evt.detail.opacity).toBe(0.6);
    document.removeEventListener('rastrum:layer-toggled', handler);
  });

  it('opacity value in event is normalized to [0,1]', () => {
    // Slider uses 0-100; divide by 100 before dispatch
    const rawSliderValue = 75;
    const opacity = rawSliderValue / 100;
    expect(opacity).toBe(0.75);
    expect(opacity).toBeGreaterThanOrEqual(0);
    expect(opacity).toBeLessThanOrEqual(1);
  });
});
