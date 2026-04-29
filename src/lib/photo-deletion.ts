// Pure helper for the obs-detail Photos tab (PR6 of M03 redesign).
//
// Decides whether soft-deleting a photo should also demote the primary
// identification (clear validated_by/validated_at + is_research_grade=false)
// and bump observations.last_material_edit_at — the "needs review" cascade.
//
// `is_primary` on media_files is the v1 proxy for "the photo the cascade
// ran on" — the v1 schema has no identifications.source_photo_id column.
// A future schema delta adding source_photo_id would make this exact
// rather than a proxy; the helper signature is stable so the swap is
// a one-line change inside this function.

export interface PhotoForDeletion {
  id: string;
  is_primary: boolean;
  deleted_at: string | null;
}

/**
 * willDemote returns true when deleting `deletingId` should also fire the
 * primary-ID demote + last_material_edit_at bump in the same transaction.
 *
 * Two trigger conditions (per the obs-detail-redesign spec):
 *   1. Deleting the photo would leave zero active (deleted_at IS NULL) photos.
 *   2. The photo being deleted is the cascade-driving photo (proxied as
 *      `is_primary = true` on media_files; see file header).
 */
export function willDemote(
  photos: PhotoForDeletion[],
  deletingId: string,
): boolean {
  const target = photos.find((p) => p.id === deletingId);
  if (!target || target.deleted_at != null) {
    // Deleting a non-existent or already-deleted row is a no-op for the
    // demote calculus — return false so callers don't fire spurious demotes.
    return false;
  }
  const remainingActive = photos.filter(
    (p) => p.id !== deletingId && p.deleted_at == null,
  );
  if (remainingActive.length === 0) return true;
  if (target.is_primary) return true;
  return false;
}
