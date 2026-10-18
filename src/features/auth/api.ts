import "server-only";
import type { Tx } from "@/db";
import {
  createInvite as createInviteFlow,
  createPasswordResetLink as createResetLinkFlow,
  revokeInvite as revokeInviteFlow,
} from "@/lib/auth/flows";
import { revokeAllSessions as revokeAll } from "@/lib/auth/session";
import type { Actor } from "@/lib/types";

// F auth API (BUILD_PLAN §2) for other groups (B8 team/invites, deactivation).
// No permission checks here: callers run inside action({ perm: 'users.invite' | 'users.manage' }).

/** Create a 7-day invite. Delivery is the caller's job (enqueueMessage 'user.invite'). Emits user.invited. */
export function createInvite(
  tx: Tx,
  input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    role: string;
    workerType: "w2" | "1099";
  },
  actor: Actor,
  opts?: { emit?: boolean },
): Promise<{ inviteId: string; url: string; expiresAt: Date }> {
  return createInviteFlow(tx, input, actor, opts);
}

export function revokeInvite(
  tx: Tx,
  inviteId: string,
  actor: Actor,
): Promise<void> {
  return revokeInviteFlow(tx, inviteId, actor);
}

/** Admin-generated 30-minute single-use reset link (share it when no email driver is set up). */
export function createPasswordResetLink(
  tx: Tx,
  userId: string,
  actor: Actor,
): Promise<{ url: string; expiresAt: Date }> {
  return createResetLinkFlow(tx, userId, actor);
}

/** Revoke every live session of a user (deactivation, "sign out other devices"). */
export function revokeAllSessions(
  tx: Tx,
  userId: string,
  opts?: { exceptSessionId?: string },
): Promise<number> {
  return revokeAll(tx, userId, opts);
}
