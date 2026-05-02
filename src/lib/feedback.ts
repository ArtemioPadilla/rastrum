/**
 * Feedback system — micro-surveys triggered after journey completions
 * and key user actions. Responses stored in localStorage (offline-first),
 * synced to Supabase when available.
 *
 * See docs/specs/modules/33-user-journeys-testing.md § Layer 3.
 */

export type SurveyType =
  | 'journey-completion'
  | 'task-completion'
  | 'friction-point'
  | 'feature-request'
  | 'nps-lite';

export type SurveyFormat =
  | 'emoji-scale'
  | 'thumbs'
  | 'free-text'
  | 'multiple-choice';

export interface MicroSurvey {
  id: string;
  type: SurveyType;
  /** i18n key for the question */
  questionKey: string;
  /** Response format */
  format: SurveyFormat;
  /** For multiple-choice: i18n keys for options */
  optionKeys?: string[];
  /** Where to show it */
  placement: 'inline' | 'bottom-sheet' | 'toast';
  /** localStorage key to prevent re-showing */
  storageKey: string;
  /** Trigger condition */
  trigger: {
    event: string;
    condition?: string;
    guideId?: string;
    delay?: number;
  };
}

export interface FeedbackResponse {
  id: string;
  surveyId: string;
  response: Record<string, unknown>;
  pagePath: string;
  createdAt: string;
  synced: boolean;
}

export const microSurveys: MicroSurvey[] = [
  {
    id: 'survey-post-onboarding',
    type: 'journey-completion',
    questionKey: 'feedback.post_onboarding',
    format: 'emoji-scale',
    placement: 'bottom-sheet',
    storageKey: 'rastrum.survey.post-onboarding',
    trigger: {
      event: 'rastrum:onboarding-event',
      condition: 'completed',
      delay: 3000,
    },
  },
  {
    id: 'survey-first-observation',
    type: 'task-completion',
    questionKey: 'feedback.first_observation',
    format: 'thumbs',
    placement: 'toast',
    storageKey: 'rastrum.survey.first-obs',
    trigger: {
      event: 'rastrum:observation-saved',
      delay: 2000,
    },
  },
  {
    id: 'survey-post-guide',
    type: 'journey-completion',
    questionKey: 'feedback.post_guide',
    format: 'emoji-scale',
    placement: 'inline',
    storageKey: 'rastrum.survey.guide',
    trigger: {
      event: 'rastrum:onboarding-event',
      condition: 'guide_completed',
      delay: 2000,
    },
  },
  {
    id: 'survey-explore-empty',
    type: 'feature-request',
    questionKey: 'feedback.explore_empty',
    format: 'multiple-choice',
    optionKeys: [
      'feedback.explore_empty_opt1',
      'feedback.explore_empty_opt2',
      'feedback.explore_empty_opt3',
    ],
    placement: 'inline',
    storageKey: 'rastrum.survey.explore-empty',
    trigger: {
      event: 'rastrum:explore-empty-state',
      delay: 5000,
    },
  },
  {
    id: 'survey-validation-first',
    type: 'task-completion',
    questionKey: 'feedback.first_validation',
    format: 'thumbs',
    placement: 'toast',
    storageKey: 'rastrum.survey.first-validation',
    trigger: {
      event: 'rastrum:validation-submitted',
      delay: 2000,
    },
  },
];

/** Check if a survey has already been shown to this user. */
export function isSurveySeen(survey: MicroSurvey): boolean {
  try {
    return localStorage.getItem(survey.storageKey) === 'done';
  } catch {
    return true;
  }
}

/** Mark a survey as shown/completed. */
export function markSurveySeen(survey: MicroSurvey): void {
  try {
    localStorage.setItem(survey.storageKey, 'done');
  } catch { /* noop */ }
}

/** Max feedback responses stored locally before oldest are pruned. */
const MAX_LOCAL_RESPONSES = 200;

/** Store a feedback response in localStorage for later sync. */
export function storeFeedbackResponse(response: FeedbackResponse): void {
  try {
    const key = 'rastrum.feedback.responses';
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]') as FeedbackResponse[];
    existing.push(response);
    // Cap storage to prevent unbounded growth on long-lived devices
    const trimmed = existing.length > MAX_LOCAL_RESPONSES
      ? existing.slice(-MAX_LOCAL_RESPONSES)
      : existing;
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch { /* noop */ }
}

/** Get all pending (unsynced) feedback responses. */
export function getPendingFeedback(): FeedbackResponse[] {
  try {
    const key = 'rastrum.feedback.responses';
    const all = JSON.parse(localStorage.getItem(key) ?? '[]') as FeedbackResponse[];
    return all.filter(r => !r.synced);
  } catch {
    return [];
  }
}

/** Mark feedback responses as synced. */
export function markFeedbackSynced(ids: string[]): void {
  try {
    const key = 'rastrum.feedback.responses';
    const all = JSON.parse(localStorage.getItem(key) ?? '[]') as FeedbackResponse[];
    for (const r of all) {
      if (ids.includes(r.id)) r.synced = true;
    }
    localStorage.setItem(key, JSON.stringify(all));
  } catch { /* noop */ }
}

/** Find the survey that should trigger for a given event. */
export function findSurveyForEvent(
  eventName: string,
  detail?: Record<string, unknown>,
): MicroSurvey | undefined {
  return microSurveys.find(s => {
    if (s.trigger.event !== eventName) return false;
    if (s.trigger.condition && detail?.type !== s.trigger.condition) return false;
    if (s.trigger.guideId && detail?.guideId !== s.trigger.guideId) return false;
    return !isSurveySeen(s);
  });
}
