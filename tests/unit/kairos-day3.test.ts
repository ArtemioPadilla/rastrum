/**
 * Unit tests for the day-3 nudge logic in kairos-fire (#897).
 *
 * Tests cover:
 *   - users with 0 observations and signup 3 days ago → should nudge
 *   - users who already got the nudge today → should skip
 *   - users with existing observations → should skip
 *   - build payload (EN / ES)
 *   - golden-hour enrichment context
 */
import { describe, it, expect } from 'vitest';

// ── Inline the logic under test (avoids Deno runtime) ─────────────────────

function buildDay3Nudge(
  lang: 'en' | 'es',
  weatherContext?: string | null,
): { title: string; body: string } {
  const weatherLine = weatherContext ? `\n${weatherContext}` : '';
  return lang === 'es'
    ? {
        title: '¡Sal a explorar! 🌿',
        body: `Ya llevas 3 días en Rastrum y aún no has registrado tu primera observación.${weatherLine} ¿Qué hay afuera hoy?`,
      }
    : {
        title: 'Go explore! 🌿',
        body: `You've been on Rastrum for 3 days but haven't logged your first observation yet.${weatherLine} What's out there today?`,
      };
}

function isDay3Candidate(params: {
  createdAt: string;
  observationCount: number;
  alreadySentTodayUtc: boolean;
  now: Date;
}): boolean {
  const { createdAt, observationCount, alreadySentTodayUtc, now } = params;
  if (observationCount > 0) return false;
  if (alreadySentTodayUtc) return false;

  const since4d = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1_000);
  const since3d = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000);
  const created = new Date(createdAt);
  return created >= since4d && created <= since3d;
}

// ── Tests ──────────────────────────────────────────────────────────────────

const now = new Date('2026-05-10T15:00:00Z');
const three_days_ago = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1_000 - 60 * 60 * 1_000).toISOString(); // 3d1h ago
const two_days_ago   = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000).toISOString();
const just_now       = now.toISOString();

describe('isDay3Candidate', () => {
  it('returns true for user signed up 3 days ago with 0 observations', () => {
    expect(isDay3Candidate({
      createdAt: three_days_ago,
      observationCount: 0,
      alreadySentTodayUtc: false,
      now,
    })).toBe(true);
  });

  it('returns false when user already has an observation', () => {
    expect(isDay3Candidate({
      createdAt: three_days_ago,
      observationCount: 1,
      alreadySentTodayUtc: false,
      now,
    })).toBe(false);
  });

  it('returns false when nudge was already sent today', () => {
    expect(isDay3Candidate({
      createdAt: three_days_ago,
      observationCount: 0,
      alreadySentTodayUtc: true,
      now,
    })).toBe(false);
  });

  it('returns false for user who signed up only 2 days ago', () => {
    expect(isDay3Candidate({
      createdAt: two_days_ago,
      observationCount: 0,
      alreadySentTodayUtc: false,
      now,
    })).toBe(false);
  });

  it('returns false for user who just signed up', () => {
    expect(isDay3Candidate({
      createdAt: just_now,
      observationCount: 0,
      alreadySentTodayUtc: false,
      now,
    })).toBe(false);
  });
});

describe('buildDay3Nudge payload', () => {
  it('builds English payload without weather context', () => {
    const p = buildDay3Nudge('en');
    expect(p.title).toContain('explore');
    expect(p.body).toContain("3 days");
    expect(p.body).not.toContain('\n');
  });

  it('builds Spanish payload without weather context', () => {
    const p = buildDay3Nudge('es');
    expect(p.title).toContain('explorar');
    expect(p.body).toContain('3 días');
    expect(p.body).not.toContain('\n');
  });

  it('injects weather context into body when provided (EN)', () => {
    const ctx = 'Golden hour is perfect right now. ☀️';
    const p = buildDay3Nudge('en', ctx);
    expect(p.body).toContain(ctx);
  });

  it('injects weather context into body when provided (ES)', () => {
    const ctx = 'La luz dorada está perfecta ahora. ☀️';
    const p = buildDay3Nudge('es', ctx);
    expect(p.body).toContain(ctx);
  });

  it('handles null weatherContext without adding blank line', () => {
    const p = buildDay3Nudge('en', null);
    expect(p.body).not.toContain('\n');
  });
});
