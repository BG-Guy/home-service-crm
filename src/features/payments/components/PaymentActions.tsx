"use client";

import {
  BadgeCheck,
  CalendarClock,
  RotateCcw,
  Send,
  Undo2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { TextArea } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  markRefundPaid,
  refundPayment,
  requestDeposit,
  schedulePromisedRefund,
  sendDepositLink,
  verifyPayments,
  waiveDeposit,
} from "../actions";

// Small client islands for payment rows: refund / promise, verify, mark refunded,
// deposit send / waive / request. Each calls one B4 action and toasts the result.

/** Refund now (to the original method) or promise a refund by a date. */
export function RefundButton({
  paymentId,
  maxCents,
  methodLabel,
  manual,
  processorReady = true,
  compact,
}: {
  paymentId: string;
  maxCents: number;
  methodLabel: string;
  manual: boolean;
  /** Card payment whose processor isn't connected: only "Promise by date" (QA2). */
  processorReady?: boolean;
  compact?: boolean;
}) {
  const sheet = useSheetState();
  const canRefundNow = manual || processorReady;
  const [mode, setMode] = useState<"now" | "promise">(
    canRefundNow ? "now" : "promise",
  );
  const [amount, setAmount] = useState<number | null>(maxCents);
  const [reason, setReason] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const valid =
    amount != null &&
    amount > 0 &&
    amount <= maxCents &&
    reason.trim().length >= 3;
  const submit = async () => {
    if (!valid || amount == null) return;
    if (mode === "now") {
      const ok = await confirm({
        title: `Refund ${formatMoney(amount)}?`,
        message: manual
          ? `Pay it back the same way (${methodLabel}), then this records it.`
          : `The money goes back to ${methodLabel}. This can't be undone.`,
        confirmLabel: "Refund",
        destructive: true,
      });
      if (!ok) return;
    }
    start(async () => {
      if (mode === "now") {
        const r = await refundPayment({
          paymentId,
          amountCents: amount,
          reason,
        });
        if (r.ok) {
          toast.success(`Refunded ${formatMoney(amount)}`);
          sheet.hide();
        } else toast.error(r.error);
      } else {
        const r = await schedulePromisedRefund({
          paymentId,
          amountCents: amount,
          reason,
          dueOn: dueOn || null,
        });
        if (r.ok) {
          toast.success("Refund promised: you'll get a reminder when it's due");
          sheet.hide();
        } else toast.error(r.error);
      }
    });
  };
  return (
    <>
      <Button
        size="sm"
        variant={compact ? "plain" : "gray"}
        icon={<Undo2 size={16} />}
        onClick={sheet.show}
        aria-haspopup="dialog"
      >
        Refund
      </Button>
      <Sheet
        {...sheet.props}
        title="Refund"
        detents={["content"]}
        dirty={reason !== ""}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <SegmentedControl<"now" | "promise">
            label="When"
            value={mode}
            onChange={setMode}
            segments={[
              { value: "now", label: "Refund now", disabled: !canRefundNow },
              { value: "promise", label: "Promise by date" },
            ]}
          />
          {!canRefundNow && (
            <p className="px-1 text-footnote text-label-2">
              Card refunds need the payment processor connected. Promise the
              refund by a date, pay it back another way, then mark it refunded.
            </p>
          )}
          <MoneyField
            label="Amount"
            valueCents={amount}
            onChangeCents={setAmount}
            max={maxCents}
            hint={`Up to ${formatMoney(maxCents)} on ${methodLabel}`}
          />
          <p className="px-1 text-footnote text-label-2">
            A partial refund on a paid invoice adds a credit note, so the
            invoice stays paid. A full refund re-opens the balance.
          </p>
          <TextArea
            label="Reason"
            value={reason}
            rows={2}
            maxLength={500}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          {mode === "promise" && (
            <>
              <DateField
                label="Refund by"
                value={dueOn}
                onChange={(e) => setDueOn(e.currentTarget.value)}
                hint="Leave empty for the default from Payments settings."
              />
              <Banner tone="info">
                A promised refund that's late is the #1 cause of "credit not
                processed" chargebacks. You'll get a task when it's due.
              </Banner>
            </>
          )}
          <Button
            size="lg"
            fullWidth
            variant={mode === "now" ? "destructive" : "filled"}
            loading={pending}
            disabled={!valid}
            onClick={submit}
            icon={
              mode === "now" ? (
                <RotateCcw size={18} />
              ) : (
                <CalendarClock size={18} />
              )
            }
          >
            {mode === "now"
              ? `Refund ${amount ? formatMoney(amount) : ""}`
              : "Schedule refund"}
          </Button>
        </div>
      </Sheet>
      {confirmEl}
    </>
  );
}

/** Office marks manual payments as verified in the bank. */
export function VerifyButton({
  paymentIds,
  label = "Verify",
}: {
  paymentIds: string[];
  label?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="tinted"
      loading={pending}
      icon={<BadgeCheck size={16} />}
      disabled={paymentIds.length === 0}
      onClick={() =>
        start(async () => {
          const r = await verifyPayments({ paymentIds });
          if (r.ok)
            toast.success(
              `${r.data?.verified ?? 0} payment${r.data?.verified === 1 ? "" : "s"} verified`,
            );
          else toast.error(r.error);
        })
      }
    >
      {label}
    </Button>
  );
}

/** A promised / pending refund was paid back outside the app. */
export function MarkRefundPaidButton({ refundId }: { refundId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="tinted"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await markRefundPaid({ refundId });
          if (r.ok) toast.success("Marked refunded");
          else toast.error(r.error);
        })
      }
    >
      Mark refunded
    </Button>
  );
}

/** Send (or re-send) a deposit link; waive with a reason. */
export function DepositActions({
  depositRequestId,
  amountCents,
  canSend,
  canWaive,
}: {
  depositRequestId: string;
  amountCents: number;
  canSend: boolean;
  canWaive: boolean;
}) {
  const [pending, start] = useTransition();
  const waive = useSheetState();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      {canSend && (
        <Button
          size="sm"
          variant="tinted"
          icon={<Send size={16} />}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await sendDepositLink({ depositRequestId });
              if (r.ok) toast.success("Deposit link on its way");
              else toast.error(r.error);
            })
          }
        >
          Send link
        </Button>
      )}
      {canWaive && (
        <>
          <Button size="sm" variant="gray" onClick={waive.show}>
            Waive
          </Button>
          <Sheet
            {...waive.props}
            title={`Waive ${formatMoney(amountCents)} deposit`}
            detents={["content"]}
            dirty={reason !== ""}
            leading={
              <Button size="sm" variant="plain" onClick={waive.hide}>
                Cancel
              </Button>
            }
          >
            <div className="flex flex-col gap-4 p-4">
              <TextArea
                label="Why is the deposit waived?"
                hint="Saved in the audit log."
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.currentTarget.value)}
              />
              <Button
                size="lg"
                fullWidth
                loading={pending}
                disabled={reason.trim().length < 3}
                onClick={() =>
                  start(async () => {
                    const r = await waiveDeposit({ depositRequestId, reason });
                    if (r.ok) {
                      toast.success("Deposit waived");
                      waive.hide();
                    } else toast.error(r.error);
                  })
                }
              >
                Waive deposit
              </Button>
            </div>
          </Sheet>
        </>
      )}
    </div>
  );
}

/** Office asks for a deposit on a job (amount chosen by staff). */
export function RequestDepositButton({
  jobId,
  cardLinks,
  suggestedCents,
}: {
  jobId: string;
  cardLinks: boolean;
  suggestedCents?: number | null;
}) {
  const sheet = useSheetState();
  const [amount, setAmount] = useState<number | null>(suggestedCents ?? null);
  const [mode, setMode] = useState<"capture" | "hold" | "manual">(
    cardLinks ? "capture" : "manual",
  );
  const [send, setSend] = useState(true);
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        variant="gray"
        onClick={sheet.show}
        aria-haspopup="dialog"
      >
        Request deposit
      </Button>
      <Sheet
        {...sheet.props}
        title="Request a deposit"
        detents={["content"]}
        leading={
          <Button size="sm" variant="plain" onClick={sheet.hide}>
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-4 p-4">
          <MoneyField
            label="Deposit amount"
            valueCents={amount}
            onChangeCents={setAmount}
            min={100}
          />
          {cardLinks ? (
            <SegmentedControl<"capture" | "hold" | "manual">
              label="How it's collected"
              value={mode}
              onChange={setMode}
              segments={[
                { value: "capture", label: "Charge now" },
                { value: "hold", label: "Card hold" },
                { value: "manual", label: "Cash/Zelle" },
              ]}
            />
          ) : (
            <p className="text-footnote text-label-2">
              No card processor: the customer pays the deposit by cash, check or
              Zelle and you record it.
            </p>
          )}
          <div className="list-card">
            <ToggleRow
              title="Send the link now"
              subtitle="Text or email the customer a pay link"
              checked={send}
              onChange={(e) => setSend(e.currentTarget.checked)}
            />
          </div>
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!amount || amount < 100}
            onClick={() =>
              start(async () => {
                const r = await requestDeposit({
                  jobId,
                  amountCents: amount ?? 0,
                  mode,
                  send,
                });
                if (r.ok) {
                  toast.success("Deposit requested");
                  sheet.hide();
                } else toast.error(r.error);
              })
            }
          >
            Request {amount ? formatMoney(amount) : "deposit"}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
