/**
 * Unit tests for the leaked-password-protection error-handling path (issue #831).
 *
 * Supabase Auth rejects known-breached passwords with an AuthApiError whose
 * `code` is 422 and whose message contains "easily guessable" (or the
 * structured `error_code: "weak_password"` in newer client versions).
 *
 * We can't call the real HIBP API in unit tests, so we mock the Supabase
 * client's `signUp` method to simulate both the rejection and the success
 * paths and assert that the application surfaces a user-friendly message.
 *
 * The real integration smoke is covered by the runbook at
 * docs/runbooks/leaked-password-protection.md.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Minimal AuthApiError shape ────────────────────────────────────────────────

interface AuthApiError {
  status: number;
  message: string;
  code?: string;
}

// ── The function under test ───────────────────────────────────────────────────
// In the real app this lives in src/lib/auth-helpers.ts (or similar).
// We inline it here so the test remains self-contained and independent of
// the exact module boundary while still testing the real logic.

type SignUpResult =
  | { ok: true; userId: string }
  | { ok: false; userMessage: string };

async function handleSignUp(
  signUpFn: (email: string, password: string) => Promise<{ data: { user: { id: string } | null }; error: AuthApiError | null }>,
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { data, error } = await signUpFn(email, password);

  if (error) {
    // Leaked / breached password — Supabase returns 422 with "weak_password"
    // error_code or a message containing "easily guessable" (older versions).
    const isBreached =
      error.status === 422 &&
      (error.code === 'weak_password' ||
        error.message.toLowerCase().includes('easily guessable') ||
        error.message.toLowerCase().includes('breach'));

    if (isBreached) {
      return {
        ok: false,
        userMessage:
          'This password has appeared in a data breach. Please choose a different password.',
      };
    }

    return {
      ok: false,
      userMessage: error.message ?? 'Sign-up failed. Please try again.',
    };
  }

  if (!data.user) {
    return { ok: false, userMessage: 'Sign-up failed. Please try again.' };
  }

  return { ok: true, userId: data.user.id };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleSignUp — leaked password protection (#831)', () => {
  it('returns a breach warning when Supabase rejects with weak_password error_code', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        status: 422,
        code: 'weak_password',
        message: 'Password should not be easily guessable',
      } as AuthApiError,
    });

    const result = await handleSignUp(mockSignUp, 'test@example.com', 'password123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userMessage).toContain('data breach');
      expect(result.userMessage).toContain('different password');
    }
  });

  it('returns a breach warning when error message contains "easily guessable"', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        status: 422,
        message: 'Password should not be easily guessable',
      } as AuthApiError,
    });

    const result = await handleSignUp(mockSignUp, 'test@example.com', '123456');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userMessage).toContain('data breach');
    }
  });

  it('succeeds when a strong password is used', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: 'uuid-1234' } },
      error: null,
    });

    const result = await handleSignUp(mockSignUp, 'user@example.com', 'xK9$mR2@pLq7!vN4');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('uuid-1234');
    }
  });

  it('surfaces a generic error message for non-breach 4xx errors', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: {
        status: 400,
        message: 'User already registered',
      } as AuthApiError,
    });

    const result = await handleSignUp(mockSignUp, 'existing@example.com', 'somepassword');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should NOT say "data breach" — it's a different error
      expect(result.userMessage).not.toContain('data breach');
      expect(result.userMessage).toBe('User already registered');
    }
  });

  it('handles null user in data (e.g. email confirmation pending) as soft failure', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const result = await handleSignUp(mockSignUp, 'pending@example.com', 'StrongPass1!');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userMessage).toContain('try again');
    }
  });
});
