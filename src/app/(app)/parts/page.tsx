import {
  CircleCheck,
  CreditCard,
  Fuel,
  Package,
  Receipt,
  ShoppingBag,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { AddReceiptButton } from "@/features/parts/components/LineActions";
import { NewReceiptButton } from "@/features/parts/components/NewReceiptButton";
import {
  listPartFlags,
  listPurchases,
  type PurchaseListItem,
  receiptPickers,
  seesAllParts,
} from "@/features/parts/queries";
import { PURCHASE_CATEGORY_LABEL } from "@/features/parts/rules";
import { SegmentLinks } from "@/features/payroll/components/SegmentLinks";
import { requireAnyPerm } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Parts & receipts" };

type Tab = "mine" | "approvals" | "unbilled" | "nonjob";

const ICON: Record<string, React.ReactNode> = {
  part: <Package size={18} aria-hidden />,
  fuel: <Fuel size={18} aria-hidden />,
  vehicle: <Wrench size={18} aria-hidden />,
  tool: <Wrench size={18} aria-hidden />,
  supplies: <ShoppingBag size={18} aria-hidden />,
  other: <Receipt size={18} aria-hidden />,
};

function statusPill(p: PurchaseListItem) {
  if (p.paidBy === "company")
    return (
      <Pill size="sm" tone="indigo">
        Company card
      </Pill>
    );
  if (p.status === "approved")
    return (
      <Pill size="sm" tone="green">
        {p.autoApproved ? "Auto-approved" : "Approved"}
      </Pill>
    );
  if (p.status === "rejected")
    return (
      <Pill size="sm" tone="red">
        Rejected
      </Pill>
    );
  return (
    <Pill size="sm" tone="orange">
      Pending
    </Pill>
  );
}

function PurchaseRows({
  rows,
  showWho,
  canAttach,
}: {
  rows: PurchaseListItem[];
  showWho: boolean;
  canAttach: (p: PurchaseListItem) => boolean;
}) {
  return rows.map((p) => (
    <ListRow
      key={p.id}
      icon={
        p.paidBy === "company" ? (
          <CreditCard size={18} aria-hidden />
        ) : (
          ICON[p.category]
        )
      }
      iconTone={
        p.status === "rejected"
          ? "red"
          : p.status === "pending"
            ? "orange"
            : "green"
      }
      multiline
      title={
        p.notes || p.vendor || PURCHASE_CATEGORY_LABEL[p.category] || "Receipt"
      }
      subtitle={
        <span className="flex flex-col gap-1">
          <span>
            {[
              p.vendor && p.notes ? p.vendor : null,
              p.jobNumber,
              p.purchasedOn ? formatDateKey(p.purchasedOn) : null,
              showWho ? p.purchaser : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {p.status === "rejected" && p.rejectReason && (
            <span className="text-danger">{p.rejectReason}</span>
          )}
          {!p.hasReceipt && p.status !== "rejected" && (
            <span className="flex items-center gap-2">
              <span className="text-danger">No receipt photo</span>
              {canAttach(p) && (
                <AddReceiptButton partPurchaseId={p.id} jobId={p.jobId} />
              )}
            </span>
          )}
        </span>
      }
      detail={
        <span className="flex flex-col items-end gap-1">
          <span className="num text-label">{formatMoney(p.totalCents)}</span>
          {statusPill(p)}
        </span>
      }
    />
  ));
}

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPerm([
    "parts.add_to_job",
    "parts.submit_receipt",
    "parts.approve_reimbursement",
  ]);
  if (!(await isEnabled("parts"))) notFound();
  const sp = await searchParams;
  const approver = user.perms.has("parts.approve_reimbursement");
  const all = seesAllParts(user);
  const tabs: { value: Tab; label: string }[] = [
    { value: "mine", label: "Mine" },
    ...(approver ? [{ value: "approvals" as const, label: "To approve" }] : []),
    ...(all ? [{ value: "unbilled" as const, label: "Flags" }] : []),
    { value: "nonjob", label: "Non-job" },
  ];
  const requested = String(sp.tab ?? "");
  const tab: Tab = tabs.some((t) => t.value === requested)
    ? (requested as Tab)
    : approver
      ? "approvals"
      : "mine";
  const canAttach = (p: PurchaseListItem) =>
    p.purchaserId === user.id || approver;
  const pickers = user.perms.has("parts.submit_receipt")
    ? await receiptPickers(user)
    : null;

  let body: React.ReactNode;
  if (tab === "unbilled") {
    const f = await listPartFlags();
    const none =
      !f.unbilled.length &&
      !f.noReceipt.length &&
      !f.stale.length &&
      !f.losses.length;
    body = none ? (
      <div className="list-card">
        <EmptyState
          icon={<CircleCheck size={44} strokeWidth={1.5} />}
          title="No flags"
          message="Every receipt is billed, every tech part has a receipt, and no job lost money on parts."
        />
      </div>
    ) : (
      <>
        {f.unbilled.length > 0 && (
          <ListSection
            header="Receipts not billed to a customer"
            footer="Bought (tech or company card) but no matching invoice line."
          >
            <PurchaseRows rows={f.unbilled} showWho canAttach={canAttach} />
          </ListSection>
        )}
        {f.noReceipt.length > 0 && (
          <ListSection header="Tech parts without an approved receipt">
            {f.noReceipt.map((r) => (
              <ListRow
                key={r.lineItemId}
                icon={<Receipt size={18} aria-hidden />}
                iconTone="red"
                title={r.name}
                subtitle={r.jobNumber}
                href={`/jobs/${r.jobId}?tab=parts`}
                detail={formatMoney(r.totalCents)}
              />
            ))}
          </ListSection>
        )}
        {f.stale.length > 0 && (
          <ListSection
            header={`Waiting over ${f.staleDays} days ⚖️`}
            footer="Accountable plans require receipts and reimbursements to be settled promptly."
          >
            <PurchaseRows rows={f.stale} showWho canAttach={canAttach} />
          </ListSection>
        )}
        {f.losses.length > 0 && (
          <ListSection header="Parts cost more than billed">
            {f.losses.map((l) => (
              <ListRow
                key={l.jobId}
                icon={<Package size={18} aria-hidden />}
                iconTone="red"
                title={l.jobNumber}
                subtitle={`Cost ${formatMoney(l.costCents)} · billed ${formatMoney(l.priceCents)}`}
                href={`/jobs/${l.jobId}?tab=parts`}
              />
            ))}
          </ListSection>
        )}
      </>
    );
  } else {
    const rows = await listPurchases(tab);
    body =
      rows.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={<Receipt size={44} strokeWidth={1.5} />}
            title={
              tab === "approvals" ? "Nothing to approve" : "No receipts yet"
            }
            message={
              tab === "approvals"
                ? "Tech-paid receipts that need a look show up here."
                : "Snap a receipt whenever you buy a part, fuel or supplies. Approved receipts are reimbursed on your next statement."
            }
          />
        </div>
      ) : (
        <>
          {tab === "approvals" && (
            <div className="flex justify-end">
              <Button
                href="/approvals?kind=part_purchase"
                size="sm"
                variant="tinted"
              >
                Review in Approvals
              </Button>
            </div>
          )}
          <ListSection>
            <PurchaseRows
              rows={rows}
              showWho={tab !== "mine"}
              canAttach={canAttach}
            />
          </ListSection>
        </>
      );
  }

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Parts & receipts"
        trailing={
          <div className="flex items-center gap-2">
            {pickers && (
              <NewReceiptButton
                trigger={false}
                defaultOpen={sp.new === "receipt"}
                jobs={pickers.jobs}
                vehicles={pickers.vehicles}
              />
            )}
            {/* "Upload receipt" (?new=receipt) opens the sheet above. */}
            <HeaderActions own="receipt" />
          </div>
        }
      />
      <Page>
        <div className="flex flex-col gap-[var(--section-gap)]">
          <SegmentLinks
            param="tab"
            value={tab}
            segments={tabs}
            label="Receipts view"
          />
          {body}
          {tab === "mine" && (
            <p className="px-4 text-footnote text-label-2">
              Parts you buy for a job are reimbursed in full and deducted from
              that job&apos;s commission base. Fuel, tools and supplies are
              reimbursed separately.{" "}
              <Link className="text-accent-text" href="/pay">
                See your pay
              </Link>
            </p>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
