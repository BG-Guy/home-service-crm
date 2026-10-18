// Shared core types (BUILD_PLAN §2). Isomorphic: type-only plus one constant.
import type { ActorKind, BaseRole, EntityType, WorkerType } from "@/db/enums";
import type { Perm } from "./permissions";

/** Who performed a change (written to audit_log / activity / events). */
export type Actor = {
  kind: ActorKind; // 'user' | 'system' | 'api' | 'webhook' | 'public_token'
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  tokenId?: string | null;
};

/** Cron, event handlers, seeds and other unattended work. */
export const SYSTEM_ACTOR: Actor = Object.freeze({
  kind: "system",
  userId: null,
}) as Actor;

/** Polymorphic link to any row (media, notes, activity, audit, tags, approvals…). */
export type EntityRef = { type: EntityType; id: string };

/** Device geostamp. `at` is the device ISO timestamp. */
export type Geo = {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  at?: string;
};

/** Server action return shape (§8.2). Works with `useActionState`. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** The signed-in user as seen by every request (getCurrentUser). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  role: string; // roles.key (may be a custom role)
  baseRole: BaseRole; // which DEFAULT_GRANTS the role inherits
  status: string;
  workerType: WorkerType;
  usesCompanyTools: boolean;
  usesCompanyVehicle: boolean;
  monitoringNoticeAckAt: Date | null;
  perms: ReadonlySet<Perm>;
  sessionId: string;
}

/** Recursive partial (settings patches). Arrays are replaced, not merged. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
