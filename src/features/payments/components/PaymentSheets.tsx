"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { loadOpenInvoices } from "../actions";
import { flagReceipt } from "../public-actions";

// The sheets behind the payment slot buttons (payments/slots.client.tsx). This
// module is a lazy chunk: the buttons render with the page, the sheet code loads
// on hover/focus or the first tap. The collect body is a second lazy chunk.

const CollectSheet = dynamic(() => import("./CollectSheet"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-3 p-4" aria-busy>
      <Skeleton className="h-20 w-full" rounded="card" />
      <Skeleton className="h-[160px] w-full" rounded="card" />
    </div>
  ),
});

interface Ctl {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The sheet's sticky footer slot: the lazy body renders its main button into it
 * (a portal), so "Record $414.84 in cash" never sits below the fold (Quote to Paid I3).
 */
function useFooterSlot() {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return {
    slot,
    footer: <div ref={setSlot} className="min-h-[52px]" />,
  };
}

/** S19 sheet: "Get paid". */
export function CollectPaymentSheet({
  open,
  onOpenChange,
  jobId,
  invoiceId,
  allowDeposit,
  defaultTarget,
}: Ctl & {
  jobId?: string;
  invoiceId?: string;
  allowDeposit?: boolean;
  defaultTarget?: "deposit" | "balance";
}) {
  const hide = () => onOpenChange(false);
  const f = useFooterSlot();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Get paid"
      detents={["large"]}
      trailing={
        <Button size="sm" variant="plain" onClick={hide}>
          Close
        </Button>
      }
      footer={f.footer}
    >
      {open && (
        <CollectSheet
          jobId={jobId}
          invoiceId={invoiceId}
          allowDeposit={allowDeposit}
          defaultTarget={defaultTarget}
          onClose={hide}
          footer={f.slot}
        />
      )}
    </Sheet>
  );
}

type OpenInvoice = {
  id: string;
  number: string;
  jobId: string | null;
  totalCents: number;
  balanceCents: number;
};

/** S20 sheet: pick an open invoice, then collect. */
export function RecordPaymentSheet({
  open,
  onOpenChange,
  customerId,
  invoiceId,
}: Ctl & { customerId: string; invoiceId?: string }) {
  const [picked, setPicked] = useState<string | null>(invoiceId ?? null);
  const [list, setList] = useState<OpenInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hide = () => onOpenChange(false);
  const f = useFooterSlot();
  // Each time the sheet opens: start from the given invoice, else fetch the open ones.
  useEffect(() => {
    if (!open) return;
    setPicked(invoiceId ?? null);
    if (invoiceId) return;
    let live = true;
    loadOpenInvoices({ customerId }).then((r) => {
      if (!live) return;
      if (r.ok) setList(r.data ?? []);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, invoiceId, customerId]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={picked ? "Get paid" : "Record payment"}
      detents={["large"]}
      leading={
        <Button size="sm" variant="plain" onClick={hide}>
          Cancel
        </Button>
      }
      footer={picked ? f.footer : undefined}
      onClosed={() => {
        setList(null);
        setError(null);
      }}
    >
      {open &&
        (picked ? (
          <CollectSheet invoiceId={picked} onClose={hide} footer={f.slot} />
        ) : (
          <div className="p-4">
            {error ? (
              <p role="alert" className="text-subhead text-danger">
                {error}
              </p>
            ) : !list ? (
              <Skeleton className="h-[132px] w-full" rounded="card" />
            ) : list.length === 0 ? (
              <p className="py-8 text-center text-subhead text-label-2">
                No open invoices: everything is paid.
              </p>
            ) : (
              <ListSection
                header="Open invoices"
                footer="Pick the invoice this payment is for."
              >
                {list.map((inv) => (
                  <ListRow
                    key={inv.id}
                    title={inv.number}
                    subtitle={`Total ${formatMoney(inv.totalCents)}`}
                    detail={`${formatMoney(inv.balanceCents)} due`}
                    accessory="chevron"
                    onClick={() => setPicked(inv.id)}
                  />
                ))}
              </ListSection>
            )}
          </div>
        ))}
    </Sheet>
  );
}

type Reason = "wrong_amount" | "not_me" | "other";

/** S28 sheet: "Wrong amount? / I didn't pay this" on the public receipt. */
export function ReceiptFlagSheet({
  open,
  onOpenChange,
  token,
  paymentId,
  onSent,
}: Ctl & { token: string; paymentId: string; onSent: () => void }) {
  const [reason, setReason] = useState<Reason>("wrong_amount");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const hide = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Something wrong?"
      detents={["content"]}
      leading={
        <Button size="sm" variant="plain" onClick={hide}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-subhead text-label-2">
          Tell us what's off and we'll call you back, usually within a few
          hours. It's faster than contacting your bank.
        </p>
        <SegmentedControl<Reason>
          label="What's wrong?"
          value={reason}
          onChange={setReason}
          segments={[
            { value: "wrong_amount", label: "Amount" },
            { value: "not_me", label: "Not me" },
            { value: "other", label: "Other" },
          ]}
        />
        <TextArea
          label="Details (optional)"
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        <Button
          size="lg"
          fullWidth
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await flagReceipt({
                token,
                paymentId,
                reason,
                note: note.trim() || null,
              });
              if (r.ok) {
                onSent();
                hide();
              } else toast.error(r.error);
            })
          }
        >
          Ask for a call back
        </Button>
      </div>
    </Sheet>
  );
}
