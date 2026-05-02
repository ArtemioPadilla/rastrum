/**
 * Journey guide registry — contextual spotlight tours that teach features
 * while users actually use them. Extends the OnboardingTour pattern into
 * per-feature guides.
 *
 * See docs/specs/modules/33-user-journeys-testing.md § Layer 2.
 */

export interface JourneyStep {
  /** CSS selector for the spotlight target element */
  target: string;
  /** i18n key for the step title */
  titleKey: string;
  /** i18n key for the step body */
  bodyKey: string;
  /** Optional: action the user must take to advance */
  requiredAction?: 'click' | 'input' | 'select' | 'navigate';
  /** Optional: selector for the action target (if different from spotlight) */
  actionTarget?: string;
}

export interface JourneyGuide {
  id: string;
  /** Route pattern where this guide activates */
  triggerRoute: RegExp;
  /** localStorage key to track completion */
  storageKey: string;
  /** When to show: 'first-visit' auto-shows; 'manual-only' requires replay */
  activation: 'first-visit' | 'manual-only';
  /** Steps reference i18n keys under the `guides` namespace */
  steps: JourneyStep[];
}

export const journeyGuides: JourneyGuide[] = [
  {
    id: 'guide-observe',
    triggerRoute: /\/(en\/observe|es\/observar)\/?$/,
    storageKey: 'rastrum.guide.observe',
    activation: 'first-visit',
    steps: [
      {
        target: '#obs2-media-trigger, [data-dropzone], input[type="file"]',
        titleKey: 'guides.observe.step1_title',
        bodyKey: 'guides.observe.step1_body',
      },
      {
        target: '#obs2-id-card, #obs-id-result, [data-id-result]',
        titleKey: 'guides.observe.step2_title',
        bodyKey: 'guides.observe.step2_body',
      },
      {
        target: '#obs2-id-card, #obs-species-confirm, [data-species-confirm]',
        titleKey: 'guides.observe.step3_title',
        bodyKey: 'guides.observe.step3_body',
      },
      {
        target: '#obs2-save-btn, #obs-save-btn, [data-save-btn]',
        titleKey: 'guides.observe.step4_title',
        bodyKey: 'guides.observe.step4_body',
      },
    ],
  },
  {
    id: 'guide-explore',
    triggerRoute: /\/(en\/explore|es\/explorar)\/?$/,
    storageKey: 'rastrum.guide.explore',
    activation: 'first-visit',
    steps: [
      {
        target: '[data-explore-tabs], .explore-tabs, main nav, nav[role="tablist"]',
        titleKey: 'guides.explore.step1_title',
        bodyKey: 'guides.explore.step1_body',
      },
      {
        target: '[data-explore-map], main a[href*="map"], .explore-card a[href*="map"]',
        titleKey: 'guides.explore.step2_title',
        bodyKey: 'guides.explore.step2_body',
      },
      {
        target: '[data-explore-filters], .explore-filters, #cf-sort',
        titleKey: 'guides.explore.step3_title',
        bodyKey: 'guides.explore.step3_body',
      },
    ],
  },
  {
    id: 'guide-validate',
    triggerRoute: /\/(en\/explore\/validate|es\/explorar\/validar)\/?$/,
    storageKey: 'rastrum.guide.validate',
    activation: 'first-visit',
    steps: [
      {
        target: '#validation-queue, [data-validation-queue]',
        titleKey: 'guides.validate.step1_title',
        bodyKey: 'guides.validate.step1_body',
      },
      {
        target: '.suggest-id-btn, [data-suggest-id]',
        titleKey: 'guides.validate.step2_title',
        bodyKey: 'guides.validate.step2_body',
      },
      {
        target: '#taxon-autocomplete, [data-taxon-search]',
        titleKey: 'guides.validate.step3_title',
        bodyKey: 'guides.validate.step3_body',
      },
    ],
  },
  {
    id: 'guide-export',
    triggerRoute: /\/(en\/profile\/export|es\/perfil\/exportar)\/?$/,
    storageKey: 'rastrum.guide.export',
    activation: 'first-visit',
    steps: [
      {
        target: '#export-format, [data-export-format]',
        titleKey: 'guides.export.step1_title',
        bodyKey: 'guides.export.step1_body',
      },
      {
        target: '#export-preset, [data-export-preset]',
        titleKey: 'guides.export.step2_title',
        bodyKey: 'guides.export.step2_body',
      },
      {
        target: '#export-download, [data-export-download]',
        titleKey: 'guides.export.step3_title',
        bodyKey: 'guides.export.step3_body',
      },
    ],
  },
  {
    id: 'guide-community',
    triggerRoute: /\/(en\/community|es\/comunidad)\/?/,
    storageKey: 'rastrum.guide.community',
    activation: 'first-visit',
    steps: [
      {
        target: '#cf-sort, [data-community-filters]',
        titleKey: 'guides.community.step1_title',
        bodyKey: 'guides.community.step1_body',
      },
      {
        target: '[data-observer-card], ul[data-observers] li:first-child, .community-list li:first-child',
        titleKey: 'guides.community.step2_title',
        bodyKey: 'guides.community.step2_body',
      },
      {
        target: '[data-follow-btn], #follow-btn, a[href*="/profile/u"]',
        titleKey: 'guides.community.step3_title',
        bodyKey: 'guides.community.step3_body',
      },
    ],
  },
  {
    id: 'guide-console',
    triggerRoute: /\/(en\/console|es\/consola)\/?$/,
    storageKey: 'rastrum.guide.console',
    activation: 'first-visit',
    steps: [
      {
        target: '[data-console-tabs], .console-tabs, nav[aria-label*="console"], nav[aria-label*="consola"]',
        titleKey: 'guides.console.step1_title',
        bodyKey: 'guides.console.step1_body',
      },
      {
        target: '[data-console-health], a[href*="health"], a[href*="salud"]',
        titleKey: 'guides.console.step2_title',
        bodyKey: 'guides.console.step2_body',
      },
      {
        target: '[data-console-keyboard], .keyboard-hint, [data-shortcut]',
        titleKey: 'guides.console.step3_title',
        bodyKey: 'guides.console.step3_body',
      },
    ],
  },
];

/** Find the guide that matches the current route, if any. */
export function findGuideForRoute(pathname: string): JourneyGuide | undefined {
  return journeyGuides.find(g => g.triggerRoute.test(pathname));
}

/** Check if a guide has been completed (seen) by the user. */
export function isGuideSeen(guide: JourneyGuide): boolean {
  try {
    return localStorage.getItem(guide.storageKey) === 'done';
  } catch {
    return true;
  }
}

/** Mark a guide as completed. */
export function markGuideSeen(guide: JourneyGuide): void {
  try {
    localStorage.setItem(guide.storageKey, 'done');
  } catch { /* noop */ }
}

/** Reset a guide so it shows again. */
export function resetGuide(guide: JourneyGuide): void {
  try {
    localStorage.removeItem(guide.storageKey);
  } catch { /* noop */ }
}
