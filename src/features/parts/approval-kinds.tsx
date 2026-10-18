// Approval kinds produced by `parts` (BUILD_PLAN §6.10). Owner: B6.
// part_purchase: tech-paid receipts that failed (or are waiting on) the auto-approve rules.
import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { jobs, partPurchases, users } from "@/db/schema";
import type {
  ApprovalDecision,
  ApprovalKindDef,
  ApprovalRow,
} from "@/features/approvals/contracts";
import { getMediaUrls } from "@/features/media/api";
import { formatMoney } from "@/lib/money";
import { formatDateKey } from "@/lib/time";
import type { Actor } from "@/lib/types";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { Pill } from "@/ui/components/StatusPill";
import { PURCHASE_FLAG_LABELS, type PurchaseFlag } from "./rules";
import { CATEGORY_LABEL, decidePurchase } from "./server/purchases";

async function brief(id: string) {
  const [r] = await db
    .select({
      p: partPurchases,
      purchaser: users.name,
      jobNumber: jobs.number,
      jobTitle: jobs.title,
    })
    .from(partPurchases)
    .leftJoin(users, eq(users.id, partPurchases.purchaserUserId))
    .leftJoin(jobs, eq(jobs.id, partPurchases.jobId))
    .where(eq(partPurchases.id, id))
    .limit(1);
  return r ?? null;
}

interface Ev {
  flags?: PurchaseFlag[];
  clean?: boolean;
  awaiting_ai?: boolean;
  ai?: {
    vendor: string | null;
    date: string | null;
    total_cents: number | null;
  } | null;
}

const ev = (a: ApprovalRow): Ev => (a.evidence ?? {}) as Ev;

const money = (c: number | null | undefined) =>
  c == null ? "—" : formatMoney(c);

const partPurchase: ApprovalKindDef = {
  entityTypes: ["part_purchase"],
  perm: "parts.approve_reimbursement",
  label: "Receipts",
  href: (a) => `/parts?tab=approvals#pp-${a.entityId}`,
  async Row({ approval }) {
    const b = await brief(approval.entityId);
    if (!b) return <span>Receipt</span>;
    const e = ev(approval);
    return (
      <span>
        {formatMoney(b.p.totalCents)}{" "}
        {CATEGORY_LABEL[b.p.category]?.toLowerCase()}
        {b.p.vendor ? ` · ${b.p.vendor}` : ""}
        {b.jobNumber ? ` · ${b.jobNumber}` : " · no job"}
        {b.purchaser ? ` · ${b.purchaser}` : ""}
        {e.awaiting_ai ? " · reading receipt…" : ""}
      </span>
    );
  },
  async Detail({ approval }) {
    const b = await brief(approval.entityId);
    if (!b)
      return <p className="text-label-2">This receipt no longer exists.</p>;
    const e = ev(approval);
    const urls = b.p.receiptMediaId
      ? await getMediaUrls([b.p.receiptMediaId], "full").catch(
          () => ({}) as Record<string, string>,
        )
      : {};
    const url = b.p.receiptMediaId ? urls[b.p.receiptMediaId] : undefined;
    const ai = e.ai ?? null;
    const mismatch =
      ai?.total_cents != null && ai.total_cents !== b.p.totalCents;
    return (
      <div className="flex flex-col gap-3">
        {(e.flags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {e.flags?.map((f) => (
              <Pill
                key={f}
                tone={f === "over_limit" ? "gray" : "orange"}
                size="sm"
              >
                {PURCHASE_FLAG_LABELS[f] ?? f}
              </Pill>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-card bg-fill-2"
            >
              {/* biome-ignore lint/performance/noImgElement: signed storage URL */}
              <img
                src={url}
                alt="Receipt"
                className="max-h-80 w-full object-contain"
              />
            </a>
          ) : (
            <div className="grid min-h-32 place-items-center rounded-card bg-fill-2 text-subhead text-label-2">
              No receipt photo
            </div>
          )}
          <KeyValueList
            items={[
              { label: "Bought by", value: b.purchaser ?? "—" },
              {
                label: "Job",
                value: b.jobNumber
                  ? `${b.jobNumber} · ${b.jobTitle}`
                  : "Not on a job",
                href: b.p.jobId ? `/jobs/${b.p.jobId}?tab=parts` : undefined,
              },
              {
                label: "Category",
                value: CATEGORY_LABEL[b.p.category] ?? b.p.category,
              },
              {
                label: "Typed total",
                value: money(b.p.totalCents),
                numeric: true,
              },
              {
                label: "Receipt says",
                value: e.awaiting_ai ? (
                  "Reading…"
                ) : ai ? (
                  <span className={mismatch ? "text-danger" : undefined}>
                    {money(ai.total_cents)}
                  </span>
                ) : (
                  "—"
                ),
                numeric: true,
              },
              {
                label: "Vendor",
                value: `${b.p.vendor ?? "—"}${ai?.vendor && ai.vendor !== b.p.vendor ? ` (receipt: ${ai.vendor})` : ""}`,
              },
              {
                label: "Date",
                value: `${b.p.purchasedOn ? formatDateKey(b.p.purchasedOn) : "—"}${ai?.date && ai.date !== b.p.purchasedOn ? ` (receipt: ${ai.date})` : ""}`,
              },
              ...(b.p.notes
                ? [{ label: "Note", value: b.p.notes, stacked: true }]
                : []),
            ]}
          />
        </div>
      </div>
    );
  },
  clean(approval) {
    const e = ev(approval);
    return !!e.clean && !e.awaiting_ai;
  },
  async editFields(approval) {
    const b = await brief(approval.entityId);
    return [
      {
        key: "totalCents",
        label: "Total",
        type: "money",
        value: b?.p.totalCents ?? null,
      },
      {
        key: "vendor",
        label: "Vendor",
        type: "text",
        value: b?.p.vendor ?? null,
      },
      {
        key: "purchasedOn",
        label: "Date",
        type: "date",
        value: b?.p.purchasedOn ?? null,
      },
    ];
  },
  async onDecide(
    tx: Tx,
    approval: ApprovalRow,
    d: ApprovalDecision,
    actor: Actor,
  ) {
    const [p] = await tx
      .select({ status: partPurchases.status })
      .from(partPurchases)
      .where(eq(partPurchases.id, approval.entityId))
      .limit(1);
    if (!p || p.status !== "pending") return; // already decided elsewhere
    await decidePurchase(tx, approval.entityId, d, actor, {
      auto: actor.kind === "system",
      approvalId: approval.id,
    });
  },
};

export const approvalKinds: ApprovalKindDef[] = [partPurchase];
