import "server-only";
import { CreditCard, Package, Receipt, ShoppingBag, Truck } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import { AddReceiptButton, RemovePartButton } from "./components/LineActions";
import type {
  JobPartsPanelProps,
  UnreceiptedPartsSectionProps,
} from "./contracts";
import { jobParts, unreceiptedForUser } from "./queries";
import { AddPartButton } from "./slots.client";

// Server UI slots produced by B6 (BUILD_PLAN §5.1). Each takes ids, resolves the viewer
// itself and returns null when the viewer may not see it or the `parts` flag is off.

const SOURCE: Record<string, { label: string; icon: React.ReactNode }> = {
  company_stock: {
    label: "Truck stock",
    icon: <Truck size={18} aria-hidden />,
  },
  company_po: {
    label: "Ordered (PO)",
    icon: <Package size={18} aria-hidden />,
  },
  company_card: {
    label: "Company card",
    icon: <CreditCard size={18} aria-hidden />,
  },
  tech_purchased: {
    label: "Bought by tech",
    icon: <ShoppingBag size={18} aria-hidden />,
  },
};

/** S38 — Part lines with source badge, receipt status, unbilled flags and Add part. */
export async function JobPartsPanel({ jobId }: JobPartsPanelProps) {
  const user = await getCurrentUser();
  if (!user || !(await isEnabled("parts"))) return null;
  const canAdd = user.perms.has("parts.add_to_job");
  if (
    !canAdd &&
    !user.perms.has("parts.view_cost") &&
    !user.perms.has("parts.approve_reimbursement")
  )
    return null;
  const data = await jobParts(jobId, user);
  if (!data) return null;
  const showCost = user.perms.has("parts.view_cost");
  const writable =
    canAdd &&
    (user.perms.has("jobs.edit") ||
      user.perms.has("jobs.status_any") ||
      (user.perms.has("jobs.status_own") && data.job.viewerIsAssignee));
  const open = !["completed", "closed", "cancelled"].includes(data.job.status);
  const totalCost = data.lines.reduce(
    (a, l) => a + Math.round((l.unitCostCents ?? 0) * l.qty),
    0,
  );
  const totalPrice = data.lines.reduce((a, l) => a + l.totalCents, 0);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <ListSection
        header="Parts"
        trailing={
          writable && data.draft ? (
            <AddPartButton
              jobId={jobId}
              mode={data.job.status === "on_hold" ? "special_order" : "any"}
              size="sm"
            />
          ) : null
        }
        footer={
          data.lines.length > 0 && showCost
            ? `Parts cost ${formatMoney(totalCost)} · billed ${formatMoney(totalPrice)}${
                totalCost > totalPrice ? " · costs more than billed" : ""
              }`
            : !data.draft
              ? `Invoice ${data.invoiceNumber ?? ""} is issued: revise it to change parts.`
              : undefined
        }
      >
        {data.lines.length === 0 ? (
          <ListRow
            icon={<Package size={18} aria-hidden />}
            iconTone="gray"
            title="No parts yet"
            subtitle={
              writable && open
                ? "Add truck stock, price-book parts or a part you bought."
                : "Parts used on this job show here."
            }
          />
        ) : (
          data.lines.map((l) => {
            const src = SOURCE[l.partSource ?? ""] ?? {
              label: "Part",
              icon: <Package size={18} aria-hidden />,
            };
            const p = l.purchase;
            const mine = p?.purchaserId === user.id;
            const receiptLabel = p
              ? !p.hasReceipt
                ? "No receipt"
                : p.status === "approved"
                  ? "Receipt approved"
                  : p.status === "rejected"
                    ? "Receipt rejected"
                    : "Receipt pending"
              : null;
            return (
              <ListRow
                key={l.id}
                icon={src.icon}
                iconTone={l.partSource === "tech_purchased" ? "orange" : "blue"}
                multiline
                title={`${l.qty !== 1 ? `${l.qty} × ` : ""}${l.name}`}
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>{src.label}</span>
                    {showCost && l.unitCostCents != null && (
                      <span className="text-label-2">
                        · cost{" "}
                        {formatMoney(Math.round(l.unitCostCents * l.qty))}
                      </span>
                    )}
                    {l.warrantyMonths ? (
                      <span className="text-label-2">
                        · {l.warrantyMonths} mo warranty
                      </span>
                    ) : null}
                    {receiptLabel && (
                      <Pill
                        size="sm"
                        tone={
                          !p?.hasReceipt || p.status === "rejected"
                            ? "red"
                            : p.status === "approved"
                              ? "green"
                              : "orange"
                        }
                      >
                        {receiptLabel}
                      </Pill>
                    )}
                    {p?.status === "rejected" && p.rejectReason && (
                      <span className="text-footnote text-danger">
                        {p.rejectReason}
                      </span>
                    )}
                    {p &&
                      !p.hasReceipt &&
                      (mine ||
                        user.perms.has("parts.approve_reimbursement")) && (
                        <AddReceiptButton partPurchaseId={p.id} jobId={jobId} />
                      )}
                  </span>
                }
                detail={
                  <span className="flex items-center gap-1">
                    <span className="num">{formatMoney(l.totalCents)}</span>
                    {writable && data.draft && (
                      <RemovePartButton
                        jobId={jobId}
                        lineItemId={l.id}
                        name={l.name}
                      />
                    )}
                  </span>
                }
              />
            );
          })
        )}
      </ListSection>
      {data.unbilled.length > 0 && showCost && (
        <ListSection
          header="Receipts not on the invoice"
          footer="Add these parts to the invoice, or tell the office if they were for something else."
        >
          {data.unbilled.map((u) => (
            <ListRow
              key={u.id}
              icon={<Receipt size={18} aria-hidden />}
              iconTone="red"
              title={u.notes ?? u.vendor ?? "Receipt"}
              subtitle={`${u.vendor ?? "Purchase"}${u.purchaser ? ` · ${u.purchaser}` : ""}`}
              detail={
                <StatusPill
                  kind="approval"
                  status="pending"
                  label="Unbilled"
                  size="sm"
                />
              }
              accessory={
                <span className="num pl-2">{formatMoney(u.totalCents)}</span>
              }
            />
          ))}
        </ListSection>
      )}
    </div>
  );
}

/** S45 — Today's tech-paid lines without a receipt, each with an upload CTA. */
export async function UnreceiptedPartsSection({
  userId,
  date,
}: UnreceiptedPartsSectionProps) {
  const user = await getCurrentUser();
  if (!user || user.id !== userId || !(await isEnabled("parts"))) return null;
  if (!user.perms.has("parts.submit_receipt")) return null;
  const tz = await getCompanyTimezone();
  const rows = await unreceiptedForUser(
    userId,
    date ?? dateKey(new Date(), tz),
    tz,
  );
  // Your own lines: parts you bought on your jobs today.
  const canOpenJobs =
    user.perms.has("jobs.view_all") || user.perms.has("jobs.view_own");
  return (
    <ListSection
      header="Receipts"
      footer={
        rows.length
          ? "Snap each receipt so your reimbursement can be approved."
          : undefined
      }
    >
      {rows.length === 0 ? (
        <ListRow
          icon={<Receipt size={18} aria-hidden />}
          iconTone="green"
          title="All receipts in"
          subtitle="Every part you bought today has a receipt."
        />
      ) : (
        rows.map((r) => (
          <ListRow
            key={r.lineItemId}
            icon={<Receipt size={18} aria-hidden />}
            iconTone="orange"
            multiline
            title={r.name}
            // "Snap" is the accessory, so only the job number links.
            subtitle={
              <>
                <TextLink
                  href={canOpenJobs ? `/jobs/${r.jobId}?tab=parts` : null}
                >
                  {r.jobNumber}
                </TextLink>
                {` · ${formatMoney(r.totalCents)}`}
              </>
            }
            accessory={
              r.partPurchaseId ? (
                <AddReceiptButton
                  partPurchaseId={r.partPurchaseId}
                  jobId={r.jobId}
                  label="Snap"
                />
              ) : (
                "none"
              )
            }
          />
        ))
      )}
    </ListSection>
  );
}
