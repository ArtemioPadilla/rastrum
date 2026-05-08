export type Theme = 'light' | 'dark' | 'auto' | 'field';
export type EffectiveTheme = 'light' | 'dark' | 'field';

export const STORAGE_KEY = 'theme';

/**
 * Lux threshold above which the Field theme auto-engages when the user's
 * stored preference is 'auto'. Direct sunlight measures ~10 000 lux; an
 * overcast outdoor sky ~1 000 lux. 5 000 picks the bright outdoor regime
 * without flipping for indoor task lighting (~300–500 lux).
 */
export const FIELD_LUX_THRESHOLD = 5000;

const VALID = new Set<Theme>(['light', 'dark', 'auto', 'field']);

export function parseStoredTheme(raw: string | null | undefined): Theme {
  if (raw && VALID.has(raw as Theme)) return raw as Theme;
  return 'auto';
}

export interface ResolveContext {
  prefersDark: boolean;
  /**
   * Latest ambient-light reading in lux, or null if AmbientLightSensor is
   * unavailable / not yet permitted. Only consulted when stored is 'auto'.
   */
  lux?: number | null;
}

export function resolveEffective(stored: Theme, ctx: ResolveContext): EffectiveTheme {
  if (stored === 'field') return 'field';
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  if (typeof ctx.lux === 'number' && ctx.lux > FIELD_LUX_THRESHOLD) return 'field';
  return ctx.prefersDark ? 'dark' : 'light';
}

/**
 * Apply an effective theme to a documentElement-shaped target. Field implies
 * the dark base palette so any element styled only with `dark:*` Tailwind
 * variants stays readable; the `.field` class then layers max-contrast
 * overrides on top via `<style is:global>` in BaseLayout / ConsoleLayout.
 */
export function applyEffective(el: { classList: DOMTokenList }, effective: EffectiveTheme): void {
  if (effective === 'field') {
    el.classList.add('dark');
    el.classList.add('field');
  } else if (effective === 'dark') {
    el.classList.add('dark');
    el.classList.remove('field');
  } else {
    el.classList.remove('dark');
    el.classList.remove('field');
  }
}
