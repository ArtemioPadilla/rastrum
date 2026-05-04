/**
 * Chat user-hint inference (#593).
 *
 * Inspects the most recent chat turns for biological keywords and maps
 * them to identify-EF user_hint values. Also propagates kingdom from the
 * prior winning identification across turns so a conversation about
 * birds doesn't keep firing PlantNet.
 *
 * Pure helpers — no side effects, easy to test.
 */

export type UserHint = 'plant' | 'animal' | 'fungi' | 'unknown';

interface TurnLike {
  role: 'user' | 'assistant';
  content: string;
  cascadeResult?: { best?: { kingdom?: string } | null } | null;
}

const PLANT_PATTERNS = [
  /\bplant(a|e|s)?\b/i,
  /\b(árbol|tree|trees|flor|flower|hoja|leaf|hierba|grass|musgo|moss)\b/i,
];
const FUNGI_PATTERNS = [
  /\b(hongo|seta|fungus|mushroom|moho|mold|liquen|lichen)\b/i,
];
const ANIMAL_PATTERNS = [
  /\b(animal|ave|p[aá]jaro|insecto|bird|insect|mammal|mam[íi]fero|reptil|fish|pez|frog|rana|murci[eé]lago|bat)\b/i,
];

/**
 * Map a kingdom string back to a UserHint. Used to propagate context
 * from a prior identification across turns.
 */
export function kingdomToHint(kingdom: string | null | undefined): UserHint {
  if (!kingdom) return 'unknown';
  switch (kingdom) {
    case 'Plantae':  return 'plant';
    case 'Fungi':    return 'fungi';
    case 'Animalia': return 'animal';
    default:         return 'unknown';
  }
}

/**
 * Infer the user_hint for the next cascade call based on the current
 * turn's content + the most recent prior identification (if any).
 *
 * Order of precedence:
 *   1. Explicit keywords in the current turn.
 *   2. Kingdom from the most recent winning ID in history.
 *   3. Keywords in the last 3 turns of history.
 *   4. 'unknown'.
 */
export function deriveHintFromConversation(
  currentTurnText: string,
  history: TurnLike[],
): UserHint {
  if (matchAny(currentTurnText, PLANT_PATTERNS))  return 'plant';
  if (matchAny(currentTurnText, FUNGI_PATTERNS))  return 'fungi';
  if (matchAny(currentTurnText, ANIMAL_PATTERNS)) return 'animal';

  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    const k = t.cascadeResult?.best?.kingdom;
    if (k) return kingdomToHint(k);
  }

  const recent = history.slice(-3).map(t => t.content).join(' ');
  if (matchAny(recent, PLANT_PATTERNS))  return 'plant';
  if (matchAny(recent, FUNGI_PATTERNS))  return 'fungi';
  if (matchAny(recent, ANIMAL_PATTERNS)) return 'animal';

  return 'unknown';
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  for (const re of patterns) if (re.test(text)) return true;
  return false;
}
