export type HeroState =
  | { kind: 'streak_at_risk'; currentDays: number; hoursLeftLocal: number }
  | { kind: 'watchlist_hit'; taxonName: string; distanceKm: number; obsId: string; observedAt: string }
  | { kind: 'pending_ids'; count: number; taxonGroup: string }
  | { kind: 'observe_default'; morningPeak: boolean };

export interface HeroInputs {
  streak: { currentDays: number; lastObsLocalDay: string | null } | null;
  watchlistHit: { taxonName: string; distanceKm: number; obsId: string; observedAt: string } | null;
  pendingIdsCount: number;
  expertTaxonGroup: string | null;
  now: Date;
  userTimezone: string;
}

function localParts(d: Date, tz: string): { hour: number; minute: number; isoDay: string } {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    return {
      hour: Number(parts.hour ?? '0'),
      minute: Number(parts.minute ?? '0'),
      isoDay: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), isoDay: d.toISOString().slice(0, 10) };
  }
}

export function resolveHeroState(inputs: HeroInputs): HeroState {
  const { hour, minute, isoDay } = localParts(inputs.now, inputs.userTimezone);

  if (
    inputs.streak &&
    inputs.streak.currentDays >= 1 &&
    inputs.streak.lastObsLocalDay !== isoDay &&
    hour >= 18
  ) {
    return {
      kind: 'streak_at_risk',
      currentDays: inputs.streak.currentDays,
      hoursLeftLocal: Math.round(((24 - hour) - minute / 60) * 10) / 10,
    };
  }

  if (inputs.watchlistHit) {
    return { kind: 'watchlist_hit', ...inputs.watchlistHit };
  }

  if (inputs.pendingIdsCount >= 3 && inputs.expertTaxonGroup) {
    return {
      kind: 'pending_ids',
      count: inputs.pendingIdsCount,
      taxonGroup: inputs.expertTaxonGroup,
    };
  }

  return { kind: 'observe_default', morningPeak: hour >= 5 && hour <= 9 };
}
