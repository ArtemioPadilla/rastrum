export type FollowTier = 'follower' | 'collaborator';
export type FollowStatus = 'pending' | 'accepted';

export interface Follow {
  follower_id: string;
  followee_id: string;
  tier: FollowTier;
  status: FollowStatus;
  requested_at: string;
  accepted_at: string | null;
}

export type ReactionTarget = 'observation' | 'photo' | 'identification';
export type ReactionKind =
  | 'fave' | 'agree_id' | 'needs_id' | 'confirm_id'
  | 'disagree_id' | 'helpful';

export interface Reaction {
  id: string;
  user_id: string;
  target_id: string;
  kind: ReactionKind;
  created_at: string;
}

export type NotificationKind =
  | 'follow' | 'follow_accepted' | 'reaction' | 'comment'
  | 'mention' | 'identification' | 'badge' | 'digest';

export interface Notification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export type ReportTarget = 'user' | 'observation' | 'photo' | 'identification' | 'comment';
export type ReportReason =
  | 'spam' | 'harassment' | 'wrong_id'
  | 'privacy_violation' | 'copyright' | 'other';

export interface Report {
  id: string;
  reporter_id: string | null;
  target_type: ReportTarget;
  target_id: string;
  reason: ReportReason;
  note: string | null;
  status: 'open' | 'triaged' | 'resolved' | 'dismissed';
  created_at: string;
}
