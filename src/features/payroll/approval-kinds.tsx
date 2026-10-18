// Approval kinds produced by `payroll` (BUILD_PLAN §6.10). Owner: B6.
// settlement_flag: a tech flagged a line on their pay statement during the 48 h review.
// Approve = resolve (optionally with an adjustment); reject = keep the line as is.
import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  jobs,
  ledgerEntries,
  payPeriods,
  settlementFlags,
  settlements,
  users,
} from "@/db/schema";
import type {
  ApprovalDecision,
  ApprovalKindDef,
  ApprovalRow,
} from "@/features/approvals/contracts";
import { writeActivity } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { formatDateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { insertPostings } from "./server/ledger";
import { refreshSettlement } from "./server/settlements";
import { companyTz, todayKey } from "./server/util";

async function brief(flagId: string) {
  const [r] = await db
    .select({
      f: settlementFlags,
      tech: users.name,
      startsOn: payPeriods.startsOn,
      endsOn: payPeriods.endsOn,
      jobNumber: jobs.number,
    })
    .from(settlementFlags)
    .innerJoin(settlements, eq(settlements.id, settlementFlags.settlementId))
    .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
    .innerJoin(users, eq(users.id, settlementFlags.userId))
    .leftJoin(jobs, eq(jobs.id, settlementFlags.jobId))
    .where(eq(settlementFlags.id, flagId))
    .limit(1);
  if (!r) return null;
  let line: { memo: string | null; amountCents: number; type: string } | null =
    null;
  if (r.f.ledgerEntryId) {
    const [l] = await db
      .select({
        memo: ledgerEntries.memo,
        amountCents: ledgerEntries.amountCents,
        type: ledgerEntries.type,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, r.f.ledgerEntryId))
      .limit(1);
    line = l ?? null;
  }
  return { ...r, line };
}

const settlementFlag: ApprovalKindDef = {
  entityTypes: ["settlement_flag"],
  perm: "payroll.manage",
  label: "Pay statement flags",
  href: () => null,
  async Row({ approval }) {
    const b = await brief(approval.entityId);
    if (!b) return <span>Flagged statement line</span>;
    return (
      <span>
        {b.tech} flagged{" "}
        {b.line
          ? `"${b.line.memo ?? b.line.type}" (${formatMoney(b.line.amountCents)})`
          : "their statement"}
        {` · week of ${formatDateKey(b.startsOn)}`}
      </span>
    );
  },
  async Detail({ approval }) {
    const b = await brief(approval.entityId);
    if (!b) return <p className="text-label-2">This flag no longer exists.</p>;
    return (
      <div className="flex flex-col gap-3">
        <blockquote className="rounded-card bg-fill-2 px-4 py-3 text-body">
          “{b.f.comment}”
        </blockquote>
        <KeyValueList
          items={[
            { label: "Tech", value: b.tech },
            {
              label: "Pay period",
              value: `${formatDateKey(b.startsOn)} – ${formatDateKey(b.endsOn)}`,
              href: `/pay/settlements/${b.f.settlementId}`,
            },
            ...(b.line
              ? [
                  { label: "Line", value: b.line.memo ?? b.line.type },
                  {
                    label: "Amount",
                    value: formatMoney(b.line.amountCents),
                    numeric: true,
                  },
                ]
              : []),
            ...(b.jobNumber
              ? [
                  {
                    label: "Job",
                    value: b.jobNumber,
                    href: `/jobs/${b.f.jobId}`,
                  },
                ]
              : []),
          ]}
        />
        <p className="text-footnote text-label-2">
          Approve to resolve the flag. Enter an adjustment (+ owed to the tech,
          − owed by the tech) if the line was wrong; it posts to this statement
          while it is in review, otherwise to the next one.
        </p>
      </div>
    );
  },
  async editFields() {
    return [
      {
        key: "adjustmentCents",
        label: "Adjustment",
        type: "money",
        value: null,
      },
      {
        key: "resolution",
        label: "Note to the tech",
        type: "text",
        value: null,
      },
    ];
  },
  async onDecide(
    tx: Tx,
    approval: ApprovalRow,
    d: ApprovalDecision,
    actor: Actor,
  ) {
    const [f] = await tx
      .select()
      .from(settlementFlags)
      .where(eq(settlementFlags.id, approval.entityId))
      .limit(1);
    if (!f || f.status !== "open") return;
    const edits = d.edits ?? {};
    const adj =
      typeof edits.adjustmentCents === "number" &&
      Number.isInteger(edits.adjustmentCents)
        ? edits.adjustmentCents
        : 0;
    const note =
      (typeof edits.resolution === "string" && edits.resolution.trim()) ||
      d.reason ||
      null;
    const now = new Date();
    await tx
      .update(settlementFlags)
      .set({
        status: d.decision === "approved" ? "resolved" : "rejected",
        resolution: note,
        resolvedBy: actor.userId,
        resolvedAt: now,
      })
      .where(eq(settlementFlags.id, f.id));
    if (d.decision === "approved" && adj !== 0) {
      const [s] = await tx
        .select({ endsOn: payPeriods.endsOn })
        .from(settlements)
        .innerJoin(payPeriods, eq(payPeriods.id, settlements.payPeriodId))
        .where(eq(settlements.id, f.settlementId))
        .limit(1);
      const today = todayKey(await companyTz(tx));
      await insertPostings(
        tx,
        [
          {
            userId: f.userId,
            type: "adjustment",
            amountCents: adj,
            wageClass: "wage",
            memo: `Statement correction${note ? `: ${note.slice(0, 80)}` : ""}`,
          },
        ],
        {
          effectiveDate: s?.endsOn ?? today,
          jobId: f.jobId,
          refTable: "settlement_flags",
          refId: f.id,
          actorUserId: actor.userId,
          today,
          keepDate: true,
        },
      );
    }
    await refreshSettlement(tx, f.settlementId);
    await writeActivity(tx, {
      entity: { type: "user", id: f.userId },
      kind:
        d.decision === "approved"
          ? "settlement.flag_resolved"
          : "settlement.flag_rejected",
      summary:
        d.decision === "approved"
          ? `Statement flag resolved${adj ? ` (${adj > 0 ? "+" : ""}${formatMoney(adj)})` : ""}`
          : "Statement flag reviewed: no change",
      data: { settlement_flag_id: f.id, adjustment_cents: adj },
      actorUserId: actor.userId,
    });
  },
};

export const approvalKinds: ApprovalKindDef[] = [settlementFlag];
