import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminClient, AdminClientError } from '../../src/lib/admin-client';

const PROJECT_URL = 'https://example.supabase.co';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('PUBLIC_SUPABASE_URL', PROJECT_URL);
});

describe('adminClient', () => {
  it('posts to /functions/v1/admin with action + payload + reason', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, audit_id: 42, after: { foo: 'bar' } }),
    });
    const out = await adminClient.role.grant(
      { target_user_id: '00000000-0000-0000-0000-000000000001', role: 'expert' },
      'reason here',
      'jwt-token',
    );
    expect(out.audit_id).toBe(42);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${PROJECT_URL}/functions/v1/admin`);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-token' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.action).toBe('role.grant');
    expect(body.reason).toBe('reason here');
  });

  it('throws AdminClientError on non-200', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 403,
      json: async () => ({ error: 'requires admin' }),
    });
    await expect(
      adminClient.role.revoke(
        { target_user_id: '00000000-0000-0000-0000-000000000001', role: 'expert' },
        'reason here', 'jwt-token',
      ),
    ).rejects.toBeInstanceOf(AdminClientError);
  });
});
