/**
 * Pure tooltip placement for the OnboardingTour overlay.
 *
 * Splits target placement into two stages:
 *   1. `pickSide(target, viewport)` — auto-flip logic. Top quartile of the
 *      viewport ⇒ render below; bottom quartile ⇒ above; otherwise lateral
 *      (right preferred, left fallback) so the tooltip never sits *on top
 *      of* the spotlight.
 *   2. `computeTooltipPosition(...)` — clamp the chosen side against the
 *      header (top), bottom-bar (mobile bottom), and viewport gutters. If
 *      clamping forces the tooltip to overlap the spotlight rect, the side
 *      is flipped once (preferring the axis with more available room).
 *
 * Pure — caller passes rects, function returns coords. Re-used by the
 * Astro client `<script>` block and by `tests/unit/onboarding-tour-
 * positioning.test.ts`.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Insets {
  headerHeight: number;
  bottomBarHeight: number;
}

export type Side = 'below' | 'above' | 'right' | 'left' | 'center';

export interface TooltipPosition {
  left: number;
  top: number;
  side: Side;
}

const GUTTER = 8;
const MARGIN = 12;

export function pickSide(target: Rect, viewport: Viewport): Side {
  const targetCenterY = target.top + target.height / 2;
  const topQuartile = viewport.height * 0.25;
  const bottomQuartile = viewport.height * 0.75;
  if (targetCenterY <= topQuartile) return 'below';
  if (targetCenterY >= bottomQuartile) return 'above';
  return 'right';
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.left + a.width  <= b.left ||
    b.left + b.width  <= a.left ||
    a.top  + a.height <= b.top  ||
    b.top  + b.height <= a.top
  );
}

function placeOnSide(
  side: Side,
  target: Rect,
  tooltip: { width: number; height: number },
  viewport: Viewport,
  insets: Insets,
): { left: number; top: number } {
  const minTop = insets.headerHeight + GUTTER;
  const maxTop = viewport.height - insets.bottomBarHeight - GUTTER - tooltip.height;
  const minLeft = GUTTER;
  const maxLeft = viewport.width - GUTTER - tooltip.width;

  let left: number;
  let top: number;

  if (side === 'below') {
    left = target.left + target.width / 2 - tooltip.width / 2;
    top  = target.top + target.height + MARGIN;
  } else if (side === 'above') {
    left = target.left + target.width / 2 - tooltip.width / 2;
    top  = target.top - MARGIN - tooltip.height;
  } else if (side === 'right') {
    left = target.left + target.width + MARGIN;
    top  = target.top + target.height / 2 - tooltip.height / 2;
  } else if (side === 'left') {
    left = target.left - MARGIN - tooltip.width;
    top  = target.top + target.height / 2 - tooltip.height / 2;
  } else {
    left = viewport.width / 2 - tooltip.width / 2;
    top  = viewport.height / 2 - tooltip.height / 2;
  }

  left = Math.max(minLeft, Math.min(left, maxLeft));
  top  = Math.max(minTop,  Math.min(top,  maxTop));
  return { left, top };
}

function flip(side: Side): Side {
  if (side === 'below') return 'above';
  if (side === 'above') return 'below';
  if (side === 'right') return 'left';
  if (side === 'left')  return 'right';
  return 'center';
}

export function computeTooltipPosition(
  target: Rect | null,
  tooltip: { width: number; height: number },
  viewport: Viewport,
  insets: Insets,
): TooltipPosition {
  if (!target) {
    return {
      left: viewport.width / 2 - tooltip.width / 2,
      top:  viewport.height / 2 - tooltip.height / 2,
      side: 'center',
    };
  }

  const preferred = pickSide(target, viewport);
  const first = placeOnSide(preferred, target, tooltip, viewport, insets);
  const firstRect: Rect = { left: first.left, top: first.top, width: tooltip.width, height: tooltip.height };

  if (!rectsOverlap(firstRect, target)) {
    return { ...first, side: preferred };
  }

  const flipped = flip(preferred);
  const second = placeOnSide(flipped, target, tooltip, viewport, insets);
  const secondRect: Rect = { left: second.left, top: second.top, width: tooltip.width, height: tooltip.height };

  if (!rectsOverlap(secondRect, target)) {
    return { ...second, side: flipped };
  }

  const centered = placeOnSide('center', target, tooltip, viewport, insets);
  return { ...centered, side: 'center' };
}
