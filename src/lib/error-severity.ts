/**
 * Pure helpers for the /console/errors/ Errors tab.
 *
 * errorSeverity — heuristic that maps an error_message to one of three
 * severities. handler_exception is loud (real bug); rate_limit_* is amber
 * (operational signal — user hit their token bucket); anything else is
 * zinc (informational).
 *
 * Used by ConsoleErrorsView to color the per-row code chip.
 */

export type ErrorSeverity = 'high' | 'medium' | 'low';

export function errorSeverity(message: string | null | undefined): ErrorSeverity {
  if (!message) return 'low';
  if (message.startsWith('rate_limit_')) return 'medium';
  if (message === 'handler_exception' || message.startsWith('handler_exception')) return 'high';
  return 'low';
}

export function severityColorClass(sev: ErrorSeverity): string {
  switch (sev) {
    case 'high':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    case 'medium':
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300';
    case 'low':
    default:
      return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';
  }
}
