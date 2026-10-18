import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  partPurchases,
} from "@/db/schema";
import { companyTz, todayKey } from "@/features/payroll/server/util";
import type { Actor } from "@/lib/types";
import type { CreatePartPurchaseInput, UnreceiptedPart } from "./contracts";
import { createPurchase } from "./server/purchases";

// B6 parts API (BUILD_PLAN §6.6). Writes take `tx` first and `actor` last; no perms.

export type * from "./contracts";

/**
 * company → approved (no ledger line); tech → pending → auto-approve rules or an
 * approvals row (+ part_purchase.submitted); queues AI receipt extraction when a
 * receipt is present; attaches the receipt media. Approved tech non-job purchases
 * post reimbursement_expense. Idempotent on clientId.
 */
export async function createPartPurchase(
  tx: Tx,
  input: CreatePartPurchaseInput,
  actor: Actor,
): Promise<{ partPurchaseId: string; status: "pending" | "approved" }> {
  return createPurchase(tx, input, actor);
}

/**
 * Tech-purchased part lines without a receipt photo on the user's jobs, added on
 * `date` (company TZ, default today). Used by S45 on /today/finish.
 */
export async function listUnreceiptedTechParts(
  userId: string,
  date?: string,
): Promise<UnreceiptedPart[]> {
  const tz = await companyTz();
  const day = date ?? todayKey(tz);
  const myJobs = db
    .select({ id: jobAssignments.jobId })
    .from(jobAssignments)
    .where(eq(jobAssignments.userId, userId));
  const rows = await db
    .select({
      lineItemId: lineItems.id,
      jobId: jobs.id,
      jobNumber: jobs.number,
      name: lineItems.name,
      totalCents: lineItems.totalCents,
      purchaser: partPurchases.purchaserUserId,
    })
    .from(lineItems)
    .innerJoin(
      invoices,
      and(
        eq(lineItems.parentType, "invoice"),
        eq(invoices.id, lineItems.parentId),
      ),
    )
    .innerJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(partPurchases, eq(partPurchases.id, lineItems.partPurchaseId))
    .where(
      and(
        eq(lineItems.partSource, "tech_purchased"),
        sql`${invoices.status} <> 'void'`,
        or(
          isNull(lineItems.partPurchaseId),
          isNull(partPurchases.receiptMediaId),
        ),
        or(
          eq(partPurchases.purchaserUserId, userId),
          and(isNull(partPurchases.purchaserUserId), inArray(jobs.id, myJobs)),
        ),
        sql`(${lineItems.createdAt} at time zone ${tz})::date = ${day}::date`,
      ),
    )
    .limit(50);
  return rows.map((r) => ({
    lineItemId: r.lineItemId,
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    name: r.name,
    totalCents: r.totalCents,
  }));
}
