"use client";

import { Link2, Mail, MessageSquare } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import {
  type QueuedOutcome,
  SendResultView,
} from "@/features/invoices/components/SendResult";
import { formatMoney } from "@/lib/money";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { toast } from "@/ui/components/Toast";
import { loadReceipt, receiptLink, sendReceipt } from "../actions";
import type { ReceiptView } from "../contracts";

// The receipt in the app (Quote to Paid I3): a sheet with a way back, instead of the
// customer's page opened in a new tab after a round trip (iOS blocks that). Sending
// it says what happened; the customer's link is reused, not minted per tap.

const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

/** "Send the receipt: Text · Email" with the result in place. */
export function ReceiptSend({
  paymentId,
  firstName,
  hasPhone,
  hasEmail,
}: {
  paymentId: string;
  firstName: string;
  hasPhone: boolean;
  hasEmail: boolean;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"sms" | "email" | null>(null);
  const [outcome, setOutcome] = useState<QueuedOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = (channel: "sms" | "email") =>
    start(async () => {
      setBusy(channel);
      setError(null);
      const r = await sendReceipt({
        paymentId,
        channel,
        clientId: newClientId(),
      });
      setBusy(null);
      if (r.ok && r.data) setOutcome(r.data.outcome);
      else if (!r.ok) setError(r.error);
    });
  if (!hasPhone && !hasEmail)
    return (
      <p className="px-1 text-footnote text-label-2">
        No phone or email on file for {firstName}, so the receipt can&apos;t be
        sent. Add one on the customer page.
      </p>
    );
  return (
    <section aria-labelledby="receipt-send-h" className="flex flex-col gap-2">
      <h3
        id="receipt-send-h"
        className="px-1 text-subhead font-semibold text-label-2"
      >
        Send the receipt
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="tinted"
          size="lg"
          icon={<MessageSquare size={18} aria-hidden />}
          disabled={!hasPhone || pending}
          loading={busy === "sms"}
          onClick={() => send("sms")}
        >
          Text
        </Button>
        <Button
          variant="tinted"
          size="lg"
          icon={<Mail size={18} aria-hidden />}
          disabled={!hasEmail || pending}
          loading={busy === "email"}
          onClick={() => send("email")}
        >
          Email
        </Button>
      </div>
      {outcome ? (
        <SendResultView
          outcome={outcome}
          firstName={firstName}
          what="receipt"
          templateKey="payment.receipt"
          templateLabel="Payment receipt"
        />
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </section>
  );
}

/** The receipt's facts (amount, how, who, what's left). */
export function ReceiptFacts({ r }: { r: ReceiptView }) {
  return (
    <KeyValueList
      items={[
        { label: "Amount", value: formatMoney(r.amountCents), numeric: true },
        ...(r.tipCents > 0
          ? [{ label: "Tip", value: formatMoney(r.tipCents), numeric: true }]
          : []),
        { label: "Paid with", value: r.methodLabel },
        ...(r.entryLabel ? [{ label: "How", value: r.entryLabel }] : []),
        ...(r.authCode ? [{ label: "Auth code", value: r.authCode }] : []),
        ...(r.invoiceNumber
          ? [{ label: "Invoice", value: r.invoiceNumber }]
          : []),
        ...(r.jobNumber ? [{ label: "Job", value: r.jobNumber }] : []),
        ...(r.collectedByName
          ? [{ label: "Collected by", value: r.collectedByName }]
          : []),
        ...(r.remainingBalanceCents != null
          ? [
              {
                label: "Remaining balance",
                value: formatMoney(Math.max(0, r.remainingBalanceCents)),
                numeric: true,
              },
            ]
          : []),
      ]}
    />
  );
}

export function ReceiptSheet({
  open,
  onOpenChange,
  paymentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
}) {
  const [data, setData] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, startLink] = useTransition();
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadReceipt({ paymentId }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setData(r.data);
      else setError(r.ok ? "Couldn't load the receipt." : r.error);
    });
    return () => {
      live = false;
    };
  }, [open, paymentId]);

  const share = () =>
    startLink(async () => {
      const r = await receiptLink({ paymentId });
      if (!r.ok || !r.data) {
        toast({ title: r.ok ? "No link" : r.error, tone: "error" });
        return;
      }
      const url = r.data.url;
      try {
        if (navigator.share)
          await navigator.share({ title: "Payment receipt", url });
        else {
          await navigator.clipboard.writeText(url);
          toast({ title: "Receipt link copied", tone: "success" });
        }
      } catch {
        /* share cancelled */
      }
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        data?.invoiceNumber ? `Receipt · ${data.invoiceNumber}` : "Receipt"
      }
      detents={["large"]}
      trailing={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4 pb-6">
        {error ? (
          <Banner tone="error" title="Can't show the receipt">
            {error}
          </Banner>
        ) : !data ? (
          <div className="flex flex-col gap-3" aria-busy>
            <Skeleton className="h-[132px] w-full" rounded="card" />
            <Skeleton className="h-[160px] w-full" rounded="card" />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1 py-2 text-center">
              <SuccessCheck size={56} label="Paid" />
              <p className="num mt-2 text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">
                {formatMoney(data.amountCents + data.tipCents)}
              </p>
              <p className="text-subhead text-label-2">
                Paid · {data.methodLabel} · {data.atLabel}
                {data.tipCents > 0
                  ? ` · tip ${formatMoney(data.tipCents)}`
                  : ""}
              </p>
            </div>
            <ReceiptFacts r={data} />
            <ReceiptSend
              paymentId={data.paymentId}
              firstName={data.customerFirstName}
              hasPhone={data.customerHasPhone}
              hasEmail={data.customerHasEmail}
            />
            {data.invoiceId ? (
              <Button
                variant="plain"
                icon={<Link2 size={18} aria-hidden />}
                loading={linking}
                onClick={share}
              >
                Share the receipt link
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
