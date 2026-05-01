export function requireCronSecret(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET');
  const got = req.headers.get('x-cron-secret');
  if (!expected) return new Response('CRON_SECRET unset on EF', { status: 500 });
  if (got !== expected) return new Response('forbidden', { status: 403 });
  return null;
}
