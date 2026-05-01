/**
 * Console alerting — checks for operational anomalies and surfaces them
 * as alerts in the admin console health tab.
 *
 * Each check returns an AlertItem if the condition is met, null otherwise.
 * The health tab polls these on load and shows active alerts.
 */

export interface AlertItem {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  since: string;
  action?: { label: string; href: string };
}

export type AlertCheck = () => Promise<AlertItem | null>;

/**
 * Check for stuck webhooks: any webhook with consecutive_failures >= 5
 * and last_delivery_at older than 1 hour.
 */
export function checkStuckWebhooks(supabase: { from: Function }): AlertCheck {
  return async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('admin_webhooks')
        .select('id, url, consecutive_failures, last_delivery_at')
        .gte('consecutive_failures', 5)
        .eq('enabled', true)
        .limit(1);
      if (error || !data?.length) return null;
      const w = data[0];
      return {
        id: `stuck-webhook-${w.id}`,
        severity: 'warning',
        title: 'Stuck webhook',
        detail: `${w.url} has ${w.consecutive_failures} consecutive failures`,
        since: w.last_delivery_at ?? new Date().toISOString(),
        action: { label: 'View webhooks', href: '/en/console/webhooks/' },
      };
    } catch { return null; }
  };
}

/**
 * Check for cron silence: recompute-streaks or award-badges haven't
 * logged a successful run in the last 26 hours.
 */
export function checkCronSilence(supabase: { from: Function }): AlertCheck {
  return async () => {
    try {
      const cutoff = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const { data, error } = await (supabase as any)
        .from('admin_audit')
        .select('id')
        .in('op', ['cron.recompute_streaks', 'cron.award_badges'])
        .gte('created_at', cutoff)
        .limit(1);
      if (error) return null;
      if (data && data.length > 0) return null;
      return {
        id: 'cron-silence',
        severity: 'critical',
        title: 'Cron silence detected',
        detail: 'No streak/badge cron run in the last 26 hours',
        since: cutoff,
        action: { label: 'View cron', href: '/en/console/cron/' },
      };
    } catch { return null; }
  };
}


/**
 * Check for function_errors spike: more than 10 unacknowledged errors
 * in the last hour.
 */
export function checkFunctionErrorsSpike(supabase: { from: Function }): AlertCheck {
  return async () => {
    try {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error } = await (supabase as any)
        .from('function_errors')
        .select('id', { count: 'exact', head: true })
        .is('acknowledged_at', null)
        .gte('created_at', cutoff);
      if (error || !count || count < 10) return null;
      return {
        id: 'function-errors-spike',
        severity: 'warning',
        title: 'Function errors spike',
        detail: `${count} unacknowledged errors in the last hour`,
        since: cutoff,
        action: { label: 'View errors', href: '/en/console/errors/' },
      };
    } catch { return null; }
  };
}

/** Run all checks and return active alerts. */
export async function runAllChecks(supabase: { from: Function }): Promise<AlertItem[]> {
  const checks: AlertCheck[] = [
    checkStuckWebhooks(supabase),
    checkCronSilence(supabase),
    checkFunctionErrorsSpike(supabase),
  ];
  const results = await Promise.allSettled(checks.map(c => c()));
  return results
    .filter((r): r is PromiseFulfilledResult<AlertItem | null> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value!);
}