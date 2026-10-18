"use client";

import { CreditCard, Flag, ReceiptText } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { loadOpenInvoices } from "./actions";
import type {
  CollectPaymentButtonProps,
  ReceiptFlagButtonProps,
  RecordPaymentButtonProps,
} from "./contracts";
import { flagReceipt } from "./public-actions";

// Client UI slots produced by B4 (BUILD_PLAN §5.1). They take serializable props and
// call only this module's own actions. The collect sheet is a lazy chunk.

const CollectSheet = dynamic(() => import("./components/CollectSheet"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-3 p-4" aria-busy>
      <Skeleton className="h-20 w-full" rounded="card" />
      <Skeleton className="h-[160px] w-full" rounded="card" />
    </div>
  ),
});

/** S19 — Collect-payment sheet (methods, tips, split payments, guards). */
export function CollectPaymentButton({
  jobId,
  invoiceId,
  label = "Collect payment",
  variant = "filled",
  size = "md",
  fullWidth,
  allowDeposit,
}: CollectPaymentButtonProps) {
  const sheet = useSheetState();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        icon={<CreditCard size={size === "lg" ? 20 : 18} />}
        onClick={sheet.show}
        aria-haspopup="dialog"
      >
        {label}
      </Button>
      <Sheet
        {...sheet.props}
        title="Collect payment"
        detents={["large"]}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Cancel
          </Button>
        }
      >
        {sheet.open && (
          <CollectSheet
            jobId={jobId}
            invoiceId={invoiceId}
            allowDeposit={allowDeposit}
            onClose={sheet.hide}
          />
        )}
      </Sheet>
    </>
  );
}

type OpenInvoice = {
  id: string;
  number: string;
  jobId: string | null;
  totalCents: number;
  balanceCents: number;
};

/** S20 — Pick an open invoice, then the collect sheet. */
export function RecordPaymentButton({
  customerId,
  invoiceId,
}: RecordPaymentButtonProps) {
  const sheet = useSheetState();
  const [picked, setPicked] = useState<string | null>(invoiceId ?? null);
  const [list, setList] = useState<OpenInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setPicked(invoiceId ?? null);
    sheet.show();
    if (!invoiceId)
      loadOpenInvoices({ customerId }).then((r) => {
        if (r.ok) setList(r.data ?? []);
        else setError(r.error);
      });
  };

  return (
    <>
      <Button
        variant="gray"
        icon={<ReceiptText size={18} />}
        onClick={open}
        aria-haspopup="dialog"
      >
        Record payment
      </Button>
      <Sheet
        {...sheet.props}
        title={picked ? "Collect payment" : "Record payment"}
        detents={["large"]}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Cancel
          </Button>
        }
        onClosed={() => {
          setList(null);
          setError(null);
        }}
      >
        {sheet.open &&
          (picked ? (
            <CollectSheet invoiceId={picked} onClose={sheet.hide} />
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
    </>
  );
}

type Reason = "wrong_amount" | "not_me" | "other";

/** S28 — "Wrong amount? / I didn't pay this" on the public receipt. */
export function ReceiptFlagButton({
  token,
  paymentId,
}: ReceiptFlagButtonProps) {
  const sheet = useSheetState();
  const [reason, setReason] = useState<Reason>("wrong_amount");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  if (sent)
    return (
      <output className="block text-center text-subhead text-label-2">
        Thanks, we'll call you shortly to sort it out.
      </output>
    );
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        icon={<Flag size={16} />}
        onClick={sheet.show}
        aria-haspopup="dialog"
      >
        Wrong amount? I didn't pay this
      </Button>
      <Sheet
        {...sheet.props}
        title="Something wrong?"
        detents={["content"]}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
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
                  setSent(true);
                  sheet.hide();
                } else toast.error(r.error);
              })
            }
          >
            Ask for a call back
          </Button>
        </div>
      </Sheet>
    </>
  );
}
