/**
 * reportFunctionError — best-effort sink for Edge Function errors.
 *
 * Writes a row to public.function_errors (admin-only read; service_role-only
 * write). Swallows its own failures so a degraded reporting path never breaks
 * the calling handler.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

export async function reportFunctionError(
  admin: SupabaseClient,
  functionName: string,
  code: string,
  actorId: string | null,
  context: Record<string, unknown>,
  err?: unknown,
): Promise<void> {
  try {
    const errorMessage =
      err instanceof Error ? err.message : err ? String(err) : null;
    await admin.from('function_errors').insert({
      function_name: functionName,
      code,
      actor_id: actorId,
      context,
      error_message: errorMessage,
    });
  } catch (_) {
    // Never throw from the reporter.
  }
}
