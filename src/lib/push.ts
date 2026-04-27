/**
 * Web Push subscription helper for the streak-push opt-in toggle.
 *
 * Spec: docs/runbooks/ux-backlog.md → ux-streak-push.
 *
 * The PWA registers /sw.js (see BaseLayout). We piggy-back on that
 * registration: ask for `Notification` permission, subscribe to the
 * pushManager with the configured VAPID public key, then upsert the
 * subscription into `public.push_subscriptions` so the nightly EF can
 * fan out. Unsubscribe is the reverse.
 *
 * We do NOT generate VAPID keys on the client — that's an operator
 * step documented in `docs/runbooks/rotate-secret.md` (VAPID setup).
 */
import { getSupabase } from './supabase';

export interface PushSetupResult {
  ok: boolean;
  reason?: 'unsupported' | 'permission_blocked' | 'vapid_missing' | 'no_user' | 'unknown';
  message?: string;
}

function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && typeof Notification !== 'undefined';
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function ab2b64(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function isStreakPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

export async function enableStreakPush(): Promise<PushSetupResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const vapidKey = import.meta.env.PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return { ok: false, reason: 'vapid_missing' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'permission_blocked' };

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidKey).buffer as ArrayBuffer,
  });

  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'no_user' };

  const subJson = sub.toJSON();
  const p256dh = (subJson.keys && (subJson.keys as { p256dh?: string }).p256dh)
    ?? ab2b64(sub.getKey('p256dh'));
  const auth = (subJson.keys && (subJson.keys as { auth?: string }).auth)
    ?? ab2b64(sub.getKey('auth'));

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City';

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent.slice(0, 200),
      tz,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) return { ok: false, reason: 'unknown', message: error.message };
  return { ok: true };
}

export async function disableStreakPush(): Promise<PushSetupResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe();
    if (endpoint) {
      const supabase = getSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('push_subscriptions').delete()
          .eq('user_id', user.id).eq('endpoint', endpoint);
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unknown', message: err instanceof Error ? err.message : String(err) };
  }
}
