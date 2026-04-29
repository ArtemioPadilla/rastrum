import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminClient, AdminClientError } from '../../src/lib/admin-client';

const PROJECT_URL = 'https://example.supabase.co';
const OBS_ID = '00000000-0000-0000-0000-000000000099';

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

  describe('observation namespace', () => {
    it('observation.hide posts action=observation.hide with observation_id', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 77, after: { hidden: true } }),
      });
      const out = await adminClient.observation.hide(
        { observation_id: OBS_ID },
        'spam content',
        'admin-jwt',
      );
      expect(out.audit_id).toBe(77);
      const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`${PROJECT_URL}/functions/v1/admin`);
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.action).toBe('observation.hide');
      expect(body.payload.observation_id).toBe(OBS_ID);
      expect(body.reason).toBe('spam content');
    });

    it('observation.unhide posts action=observation.unhide', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 78, after: { hidden: false } }),
      });
      await adminClient.observation.unhide({ observation_id: OBS_ID }, 'false positive', 'admin-jwt');
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('observation.unhide');
    });

    it('observation.obscure posts action=observation.obscure with obscure_level', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 79, after: { obscure_level: 'full' } }),
      });
      await adminClient.observation.obscure(
        { observation_id: OBS_ID, obscure_level: 'full' },
        'NOM-059 species',
        'admin-jwt',
      );
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('observation.obscure');
      expect(body.payload.obscure_level).toBe('full');
    });

    it('observation.licenseOverride posts action=observation.license_override', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 80, after: { observer_license: 'CC0' } }),
      });
      await adminClient.observation.licenseOverride(
        { observation_id: OBS_ID, license: 'CC0' },
        'contributor request',
        'admin-jwt',
      );
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('observation.license_override');
      expect(body.payload.license).toBe('CC0');
    });

    it('observation.hide throws AdminClientError on 403', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false, status: 403,
        json: async () => ({ error: 'requires admin' }),
      });
      await expect(
        adminClient.observation.hide({ observation_id: OBS_ID }, 'reason', 'bad-jwt'),
      ).rejects.toBeInstanceOf(AdminClientError);
    });
  });

  describe('badge namespace', () => {
    it('badge.awardManual posts action=badge.award_manual with target_user_id + badge_key', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 101, after: { badge_key: 'first_obs' } }),
      });
      const out = await adminClient.badge.awardManual(
        { target_user_id: '00000000-0000-0000-0000-000000000001', badge_key: 'first_obs' },
        'User hit milestone manually',
        'admin-jwt',
      );
      expect(out.audit_id).toBe(101);
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('badge.award_manual');
      expect(body.payload.badge_key).toBe('first_obs');
    });

    it('badge.revoke posts action=badge.revoke', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 102, after: null }),
      });
      await adminClient.badge.revoke(
        { target_user_id: '00000000-0000-0000-0000-000000000001', badge_key: 'first_obs' },
        'Badge awarded in error',
        'admin-jwt',
      );
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('badge.revoke');
    });
  });

  describe('featureFlag namespace', () => {
    it('featureFlag.toggle posts action=feature_flag.toggle with key + value', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, audit_id: 103, after: { key: 'parallelCascade', value: false } }),
      });
      const out = await adminClient.featureFlag.toggle(
        { key: 'parallelCascade', value: false },
        'Disabling parallel cascade due to cost spike',
        'admin-jwt',
      );
      expect(out.audit_id).toBe(103);
      const body = JSON.parse(
        ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.action).toBe('feature_flag.toggle');
      expect(body.payload.key).toBe('parallelCascade');
      expect(body.payload.value).toBe(false);
    });

    it('featureFlag.toggle throws AdminClientError when key not found', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false, status: 400,
        json: async () => ({ error: 'feature_flag.toggle: key not found: unknownFlag' }),
      });
      await expect(
        adminClient.featureFlag.toggle({ key: 'unknownFlag', value: true }, 'testing', 'admin-jwt'),
      ).rejects.toBeInstanceOf(AdminClientError);
    });
  });
});
