"use client";

import { CircleAlert, CircleCheck, Clock, MessageSquare } from "lucide-react";
import { OutboxCardView } from "@/features/messaging/components/OutboxCardView";
import type { OutboxCard } from "@/features/messaging/contracts";
import { describeSend, type SendOutcome } from "../screen-copy";

// "Sending says what happened" (Quote to Paid I4): the result of a send, said
// plainly inside the sheet that sent it, instead of a blind "Invoice sent" toast.
// When the text waits in the sender's own outbox, its card is right here to tap.

export type QueuedOutcome = SendOutcome & {
  scheduledMessageId: string;
  body: string | null;
  rawTo: string | null;
};

const TONE_ICON = {
  success: <CircleCheck aria-hidden size={22} className="text-success" />,
  info: <MessageSquare aria-hidden size={22} className="text-accent-text" />,
  warning: <Clock aria-hidden size={22} className="text-warning" />,
  error: <CircleAlert aria-hidden size={22} className="text-danger" />,
} as const;

export function SendResultView({
  outcome,
  firstName,
  what,
  templateKey,
  templateLabel,
}: {
  outcome: QueuedOutcome;
  firstName: string;
  /** "invoice" (default), "receipt", "pay link". */
  what?: string;
  templateKey: string;
  templateLabel: string;
}) {
  const copy = describeSend(outcome, { firstName, what });
  const card: OutboxCard | null =
    outcome.status === "pending_tap" &&
    outcome.mine &&
    outcome.rawTo &&
    outcome.body
      ? {
          id: outcome.scheduledMessageId,
          customerId: null,
          customerName: firstName,
          jobId: null,
          jobNumber: null,
          to: outcome.rawTo,
          channel: outcome.channel === "whatsapp" ? "whatsapp" : "sms",
          body: outcome.body,
          templateKey,
          templateLabel,
          dueAt: new Date().toISOString(),
          expiresAt: null,
          assignedUserId: null,
          assignedName: null,
          purpose: "transactional",
        }
      : null;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <div className="flex items-start gap-3 rounded-card bg-card p-4 shadow-card">
        <span className="mt-px shrink-0">{TONE_ICON[copy.tone]}</span>
        <div className="min-w-0">
          <p className="text-headline">{copy.title}</p>
          {copy.detail ? (
            <p className="text-subhead text-label-2">{copy.detail}</p>
          ) : null}
        </div>
      </div>
      {card ? <OutboxCardView card={card} emphasized /> : null}
    </div>
  );
}
