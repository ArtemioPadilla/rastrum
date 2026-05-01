import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  user_id: z.string().uuid().optional(),
  email:   z.string().email().optional(),
}).refine(p => p.user_id || p.email, {
  message: 'Either user_id or email is required',
});
type Payload = z.infer<typeof Payload>;

export interface UserDetailResult {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  identities: Array<{
    provider: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
  }>;
}

export const userDetailHandler: ActionHandler<Payload> = {
  op: 'user_pii_read',
  requiredRole: 'moderator',
  payloadSchema: Payload,
  async execute(admin, payload, _actor, _reason) {
    // Look up in auth.users via service-role RPC (direct table access
    // requires service-role; Postgres function runs as SECURITY DEFINER)
    let userId = payload.user_id;

    if (!userId && payload.email) {
      // Resolve by email via service-role listing
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw new Error(`listUsers: ${error.message}`);
      const found = (data?.users ?? []).find(
        u => u.email?.toLowerCase() === payload.email!.toLowerCase(),
      );
      if (!found) throw new Error(`No user found with email ${payload.email}`);
      userId = found.id;
    }

    const { data: user, error } = await admin.auth.admin.getUserById(userId!);
    if (error) throw new Error(`getUserById: ${error.message}`);
    if (!user?.user) throw new Error('User not found');

    const u = user.user;

    const result: UserDetailResult = {
      id:                 u.id,
      email:              u.email ?? null,
      email_confirmed_at: u.email_confirmed_at ?? null,
      created_at:         u.created_at ?? null,
      last_sign_in_at:    u.last_sign_in_at ?? null,
      identities:         (u.identities ?? []).map(i => ({
        provider:        i.provider,
        email:           (i.identity_data?.['email'] as string | undefined) ?? null,
        created_at:      i.created_at ?? null,
        last_sign_in_at: i.last_sign_in_at ?? null,
      })),
    };

    return {
      before: null,
      after:  result,
      target: { type: 'user', id: u.id },
      result,
    };
  },
};
