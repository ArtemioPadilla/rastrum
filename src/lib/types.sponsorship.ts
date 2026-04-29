export type AiProvider = 'anthropic';
export type AiCredentialKind = 'api_key' | 'oauth_token';
export type AiSponsorshipStatus = 'active' | 'paused' | 'revoked';

export interface SponsorCredential {
  id:            string;
  label:         string;
  provider:      AiProvider;
  kind:          AiCredentialKind;
  validated_at:  string | null;
  last_used_at:  string | null;
  revoked_at:    string | null;
  created_at:    string;
}

export interface Sponsorship {
  id:                 string;
  sponsor_id:         string;
  beneficiary_id:     string;
  credential_id:      string;
  provider:           AiProvider;
  monthly_call_cap:   number;
  priority:           number;
  status:             AiSponsorshipStatus;
  paused_reason:      string | null;
  paused_at:          string | null;
  beneficiary_public: boolean;
  sponsor_public:     boolean;
  created_at:         string;
  updated_at:         string;
}

export interface SponsorshipUsage {
  cap: number;
  usedThisMonth: number;
  pctUsed: number;
  currentMonthByDay: Record<string, { calls: number; tokens_in: number; tokens_out: number }>;
  pastMonths: Array<{ year_month: string; calls: number; tokens_in: number | null; tokens_out: number | null }>;
}

export type SponsorshipRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface SponsorshipRequest {
  id:                string;
  requester_id:      string;
  target_sponsor_id: string;
  message:           string | null;
  status:            SponsorshipRequestStatus;
  created_at:        string;
  responded_at:      string | null;
}
