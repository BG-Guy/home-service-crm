import "server-only";
import type { Tx } from "@/db";
import { auditLog } from "@/db/schema";
import { currentActor } from "./context";
import { type Actor, type EntityRef, SYSTEM_ACTOR } from "./types";

// Audit log writer (SPEC M22, §6.13). Append-only table; the DB trigger rejects
// UPDATE/DELETE. Covers money, permissions, settings, invoices, payments, comp plans,
// settlements, customer PII views by techs, exports and deletions.

const REDACT =
  /pass(word)?|token|secret|_enc$|^value_enc$|routing|account_number|card_number|cvc/i;

/** Replace sensitive values with "[redacted]" (deep). */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 8) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        REDACT.test(k) && v != null ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Shallow diff of two objects: only keys whose JSON value changed. Non-objects are
 * returned as-is. Used so audit rows hold a before/after diff, not whole rows.
 */
export function diffObjects(
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown } {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
  if (!isObj(before) || !isObj(after)) return { before, after };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

export interface AuditInput {
  actor?: Actor;
  /** Dotted verb, e.g. 'invoice.revised', 'customer.viewed', 'perm.changed', 'settings.updated'. */
  action: string;
  entity?: EntityRef | null;
  before?: unknown;
  after?: unknown;
  /** Store before/after verbatim instead of a key diff. */
  full?: boolean;
}

export async function writeAudit(tx: Tx, a: AuditInput): Promise<void> {
  const actor = a.actor ?? currentActor() ?? SYSTEM_ACTOR;
  let before = a.before === undefined ? null : redact(a.before);
  let after = a.after === undefined ? null : redact(a.after);
  if (!a.full && before && after)
    ({ before, after } = diffObjects(before, after));
  await tx.insert(auditLog).values({
    actorUserId: actor.userId,
    actorKind: actor.kind,
    action: a.action,
    entityType: a.entity?.type ?? null,
    entityId: a.entity?.id ?? null,
    before: before ?? null,
    after: after ?? null,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}
