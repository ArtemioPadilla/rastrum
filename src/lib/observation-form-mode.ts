/**
 * Pure helpers for the ObservationForm `mode` prop logic.
 *
 * Kept side-effect free so the mode-branching can be unit-tested
 * without rendering Astro. The actual UI glue lives inline in
 * `ObservationForm.astro`; these helpers describe the contracts so
 * we can verify them in isolation.
 */
export type ObservationFormMode = 'full' | 'identify-only';

export interface ModeLabels {
  submit: string;
  saveAsObservation: string;
  backToIdentify: string;
}

export function pickModeLabels(
  mode: ObservationFormMode,
  isEs: boolean,
  override?: Partial<ModeLabels>,
): ModeLabels {
  const fullSubmit = isEs ? 'Guardar observación' : 'Save observation';
  const idSubmit = isEs ? 'Solo identificar' : 'Just identify';
  const saveAs = isEs ? 'Guardar como observación' : 'Save as observation';
  const back = isEs ? 'Volver a solo identificar' : 'Back to identify only';
  return {
    submit: mode === 'identify-only' ? (override?.submit ?? idSubmit) : (override?.submit ?? fullSubmit),
    saveAsObservation: override?.saveAsObservation ?? saveAs,
    backToIdentify: override?.backToIdentify ?? back,
  };
}

/**
 * The set of `data-identify-hide` block kinds that the identify-only
 * stylesheet hides via `form#obs-form[data-mode="identify-only"]
 * [data-identify-hide] { display: none; }`. Listed here so tests can
 * assert the contract without parsing CSS.
 */
export const IDENTIFY_ONLY_HIDDEN_BLOCKS = [
  'evidence_type',
  'gps',
  'habitat_weather',
  'notes',
  'privacy_notice',
] as const;

/**
 * Decide what the submit button is *for* given the current mode.
 *
 * In identify-only mode, "submit" is a no-op — the result card is
 * already rendered, the button just confirms. The user must click
 * "Save as observation" to switch into full mode for a real save.
 */
export function submitIntent(mode: ObservationFormMode): 'save' | 'noop' {
  return mode === 'identify-only' ? 'noop' : 'save';
}

/**
 * Whether GPS should auto-fire on page load. We defer it in
 * identify-only mode so users who only want a quick ID don't get
 * a permission prompt.
 */
export function shouldAutoStartGPS(mode: ObservationFormMode): boolean {
  return mode === 'full';
}
