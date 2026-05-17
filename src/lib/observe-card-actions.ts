/**
 * Pure selector: which interactive actions a card state exposes. The
 * render + listener layers consume this; no DOM. See spec
 * docs/superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md
 * §Card structure / §Two-stage flow + sovereignty (#1124 Render C-3).
 */
import type { CardState } from './observe-card-state';

export type CardAction = 'affirm' | 'other' | 'review' | 'adopt' | 'dismiss';

export function cardActions(state: CardState): CardAction[] {
  switch (state) {
    case 'S1b':
    case 'S2':
      return ['affirm', 'other', 'review'];
    case 'S2prime':
      return ['adopt', 'dismiss'];
    case 'S3':
      return ['other', 'review'];
    case 'S0':
    case 'S1a':
      return [];
  }
}
