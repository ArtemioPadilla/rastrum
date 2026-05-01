export interface ExpertEligibility {
  qualifies: boolean;
  reason: 'low-species' | 'low-taxa' | 'already-expert' | 'pending' | 'qualifies';
  speciesCount: number;
  taxonCount: number;
  threshold: { species: number; taxa: number };
}

const THRESHOLD = { species: 50, taxa: 5 } as const;

export function evaluateExpertEligibility(
  user: {
    species_count?: number | null;
    is_expert?: boolean | null;
    expert_application_status?: 'pending' | 'approved' | 'rejected' | null;
  },
  expertise: { taxon_count?: number | null },
): ExpertEligibility {
  const speciesCount = user.species_count ?? 0;
  const taxonCount   = expertise.taxon_count ?? 0;
  const base = { speciesCount, taxonCount, threshold: THRESHOLD };

  if (user.is_expert)
    return { ...base, qualifies: false, reason: 'already-expert' };
  if (user.expert_application_status === 'pending' || user.expert_application_status === 'approved')
    return { ...base, qualifies: false, reason: 'pending' };
  if (speciesCount < THRESHOLD.species)
    return { ...base, qualifies: false, reason: 'low-species' };
  if (taxonCount < THRESHOLD.taxa)
    return { ...base, qualifies: false, reason: 'low-taxa' };

  return { ...base, qualifies: true, reason: 'qualifies' };
}
