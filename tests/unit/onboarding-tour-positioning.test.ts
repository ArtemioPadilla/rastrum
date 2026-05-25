import { describe, it, expect } from 'vitest';
import {
  pickSide,
  computeTooltipPosition,
  type Rect,
  type Viewport,
  type Insets,
} from '../../src/lib/tour-position';

const TOOLTIP = { width: 320, height: 180 };

const DESKTOP: Viewport = { width: 1366, height: 800 };
const TABLET:  Viewport = { width: 768,  height: 1024 };
const MOBILE:  Viewport = { width: 390,  height: 844 };

const HEADER_ONLY: Insets = { headerHeight: 56, bottomBarHeight: 0 };
const MOBILE_INSETS: Insets = { headerHeight: 56, bottomBarHeight: 64 };
const NO_INSETS: Insets = { headerHeight: 0, bottomBarHeight: 0 };

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.left + a.width  <= b.left ||
    b.left + b.width  <= a.left ||
    a.top  + a.height <= b.top  ||
    b.top  + b.height <= a.top
  );
}

describe('pickSide', () => {
  it('returns "below" when target is in the top quartile', () => {
    const target: Rect = { left: 100, top: 20, width: 100, height: 40 };
    expect(pickSide(target, DESKTOP)).toBe('below');
  });

  it('returns "above" when target is in the bottom quartile', () => {
    const target: Rect = { left: 100, top: 700, width: 100, height: 40 };
    expect(pickSide(target, DESKTOP)).toBe('above');
  });

  it('returns lateral ("right") when target is in the middle band', () => {
    const target: Rect = { left: 100, top: 380, width: 100, height: 40 };
    expect(pickSide(target, DESKTOP)).toBe('right');
  });
});

describe('computeTooltipPosition', () => {
  it('centers tooltip when target is null', () => {
    const pos = computeTooltipPosition(null, TOOLTIP, DESKTOP, HEADER_ONLY);
    expect(pos.side).toBe('center');
    expect(pos.left).toBeCloseTo(DESKTOP.width / 2 - TOOLTIP.width / 2);
    expect(pos.top).toBeCloseTo(DESKTOP.height / 2 - TOOLTIP.height / 2);
  });

  it('never lets tooltip overlap the header (top is below headerHeight + 8)', () => {
    // Target near the top — preferred side is "below", which is naturally
    // below the header. Force a worst case where target is mid-band so the
    // lateral placement could ride up — clamp must still respect header.
    const target: Rect = { left: 0, top: 40, width: 80, height: 40 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, HEADER_ONLY);
    expect(pos.top).toBeGreaterThanOrEqual(HEADER_ONLY.headerHeight + 8);
  });

  it('never lets tooltip overlap the mobile bottom bar', () => {
    // Target near the bottom of a mobile viewport.
    const target: Rect = { left: 150, top: 740, width: 60, height: 60 };
    const pos = computeTooltipPosition(target, TOOLTIP, MOBILE, MOBILE_INSETS);
    expect(pos.top + TOOLTIP.height).toBeLessThanOrEqual(
      MOBILE.height - MOBILE_INSETS.bottomBarHeight - 8,
    );
  });

  it('keeps tooltip inside viewport gutters', () => {
    // Target at the far right edge: would push the tooltip off-screen.
    const target: Rect = { left: 1350, top: 380, width: 16, height: 40 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, HEADER_ONLY);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + TOOLTIP.width).toBeLessThanOrEqual(DESKTOP.width - 8);
  });

  it('places tooltip below when target is high in the viewport', () => {
    const target: Rect = { left: 100, top: 30, width: 80, height: 40 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, HEADER_ONLY);
    expect(pos.side).toBe('below');
    expect(pos.top).toBeGreaterThanOrEqual(target.top + target.height);
  });

  it('places tooltip above when target is low in the viewport', () => {
    const target: Rect = { left: 100, top: 720, width: 80, height: 40 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, HEADER_ONLY);
    expect(pos.side).toBe('above');
    expect(pos.top + TOOLTIP.height).toBeLessThanOrEqual(target.top);
  });

  it('tooltip never overlaps the spotlight target rect (desktop, top-nav case)', () => {
    // Reproduces the audit defect: spotlight target = "Observe" nav link
    // near top of viewport on desktop /observe.
    const target: Rect = { left: 220, top: 20, width: 70, height: 32 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, HEADER_ONLY);
    const tooltipRect: Rect = { left: pos.left, top: pos.top, width: TOOLTIP.width, height: TOOLTIP.height };
    expect(rectsOverlap(tooltipRect, target)).toBe(false);
  });

  it('tooltip never overlaps the spotlight target rect (mobile, sign-in case)', () => {
    // Reproduces the audit defect: spotlight target = "Sign in" header pill
    // on mobile observe-es. Target is in top band so tooltip should drop below.
    const target: Rect = { left: 290, top: 16, width: 80, height: 32 };
    const pos = computeTooltipPosition(target, TOOLTIP, MOBILE, MOBILE_INSETS);
    const tooltipRect: Rect = { left: pos.left, top: pos.top, width: TOOLTIP.width, height: TOOLTIP.height };
    expect(rectsOverlap(tooltipRect, target)).toBe(false);
  });

  it('all 7 step layouts: render without overlap on 3 viewports', () => {
    // Synthetic positions corresponding to the 7 tour steps:
    //   0 welcome (no target — centered, n/a)
    //   1 fab/observe-nav  → top-left header link, ~y=20
    //   2 quick-id fab     → top header link (same selector)
    //   3 first-obs demo (no target)
    //   4 explore-tab/explore-nav → top header link, ~y=20, further right
    //   5 privacy preset (no target)
    //   6 profile/avatar-btn → top-right corner, ~y=18
    const targets: Array<Rect | null> = [
      null,
      { left: 180, top: 20,  width: 70, height: 32 },
      { left: 180, top: 20,  width: 70, height: 32 },
      null,
      { left: 280, top: 20,  width: 80, height: 32 },
      null,
      { left: 1320, top: 18, width: 32, height: 32 },
    ];
    for (const viewport of [DESKTOP, TABLET, MOBILE]) {
      const insets = viewport === MOBILE ? MOBILE_INSETS : HEADER_ONLY;
      for (const t of targets) {
        const tgt = t === null ? null : { ...t, left: Math.min(t.left, viewport.width - t.width) };
        const pos = computeTooltipPosition(tgt, TOOLTIP, viewport, insets);
        expect(pos.left).toBeGreaterThanOrEqual(8);
        expect(pos.left + TOOLTIP.width).toBeLessThanOrEqual(viewport.width - 8);
        expect(pos.top).toBeGreaterThanOrEqual(insets.headerHeight === 0 ? 8 : insets.headerHeight + 8 - 0.5);
        if (insets.bottomBarHeight > 0) {
          expect(pos.top + TOOLTIP.height).toBeLessThanOrEqual(viewport.height - insets.bottomBarHeight - 8 + 0.5);
        }
        if (tgt) {
          const tooltipRect: Rect = { left: pos.left, top: pos.top, width: TOOLTIP.width, height: TOOLTIP.height };
          expect(rectsOverlap(tooltipRect, tgt)).toBe(false);
        }
      }
    }
  });

  it('respects header inset even when zero (no header element on page)', () => {
    const target: Rect = { left: 100, top: 50, width: 80, height: 40 };
    const pos = computeTooltipPosition(target, TOOLTIP, DESKTOP, NO_INSETS);
    expect(pos.top).toBeGreaterThanOrEqual(8);
  });
});
