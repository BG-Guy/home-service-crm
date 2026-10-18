import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import type { PolicyKind } from "@/db/enums";
import { policyVersions } from "@/db/schema";
import { writeAudit } from "./audit";
import { sha256Hex } from "./hash";
import type { Actor } from "./types";

// Versioned policy texts (SPEC §6.2 policy_versions): cancellation, refund, warranty,
// deposit, e-sign consent, SMS terms, privacy, comp/tool agreements, monitoring
// notice, cooling-off, card-on-file, direct-deposit auth. Immutable once referenced:
// edits publish a new version; signatures/deposits store the version id + sha256.

export type PolicyVersionRow = typeof policyVersions.$inferSelect;

/** Latest version of a policy (null if never published). */
export async function getCurrentPolicy(
  kind: PolicyKind,
  exec: Tx = db,
): Promise<PolicyVersionRow | null> {
  const [row] = await exec
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.kind, kind))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return row ?? null;
}

/** Publish a new version (no-op returning the current one when the text is unchanged). Audited. */
export async function publishPolicyVersion(
  tx: Tx,
  p: { kind: PolicyKind; title: string; body: string },
  actor: Actor,
): Promise<PolicyVersionRow> {
  const sha256 = sha256Hex(`${p.title}\n\n${p.body}`);
  const current = await getCurrentPolicy(p.kind, tx);
  if (current && current.sha256 === sha256) return current;
  const [row] = await tx
    .insert(policyVersions)
    .values({
      kind: p.kind,
      version: sql`coalesce((select max(version) from policy_versions where kind = ${p.kind}), 0) + 1`,
      title: p.title,
      body: p.body,
      sha256,
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new Error("policy insert failed");
  await writeAudit(tx, {
    actor,
    action: "policy.published",
    entity: { type: "policy_version", id: row.id },
    after: { kind: p.kind, version: row.version, sha256 },
    full: true,
  });
  return row;
}
