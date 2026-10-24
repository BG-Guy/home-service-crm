// Plain words for the invoice screen (Quote to Paid, Part I). Pure and client-safe;
// pinned by tests/golden/invoice-screen-copy.test.ts.
import { formatMoney } from "@/lib/money";

/** "−$90.00": a true minus sign, the way receipts print it. */
export function minusMoney(cents: number): string {
  return `−${formatMoney(Math.abs(cents))}`;
}

export interface BalancePart {
  text: string;
  /** Money that came off the balance (deposits, payments, credits). */
  off?: boolean;
}

/**
 * The line under the big balance: "Better $450.73 · Deposit −$90.00". The first part
 * names the approved option when the invoice still bills exactly what was signed,
 * else "Total". Every part moves the balance, so the line always adds up:
 * total − deposit − paid − credits = balance due.
 */
export function balanceParts(i: {
  totalCents: number;
  optionLabel?: string | null;
  signedTotalCents?: number | null;
  depositCents: number;
  paidCents: number;
  creditCents: number;
}): BalancePart[] {
  const named = !!i.optionLabel?.trim() && i.signedTotalCents === i.totalCents;
  const parts: BalancePart[] = [
    {
      text: `${named ? i.optionLabel?.trim() : "Total"} ${formatMoney(i.totalCents)}`,
    },
  ];
  if (i.depositCents > 0)
    parts.push({ text: `Deposit ${minusMoney(i.depositCents)}`, off: true });
  if (i.paidCents > 0)
    parts.push({ text: `Paid ${minusMoney(i.paidCents)}`, off: true });
  if (i.creditCents > 0)
    parts.push({ text: `Credits ${minusMoney(i.creditCents)}`, off: true });
  return parts;
}

/** "2 × Grade 1 deadbolt" (no "1 ×"; up to 3 decimals for hours). */
export function qtyName(qty: number, name: string): string {
  if (qty === 1) return name;
  const q = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(
    qty,
  );
  return `${q} × ${name}`;
}

// ------------------------------------------------------------------ sending

export type SendStatus =
  | "scheduled"
  | "deferred_quiet"
  | "pending_tap"
  | "sent"
  | "sent_manual"
  | "skipped"
  | "delivered"
  | "failed"
  | "canceled"
  | "suppressed_optout"
  | "expired";

/** What a send did, as the server saw it right after queueing it. */
export interface SendOutcome {
  status: SendStatus;
  /** Resolved channel ("sms", "email", "whatsapp"; "customer_preferred" if unresolved). */
  channel: string;
  /** Where it goes (masked outside the sender's contact window). */
  to: string | null;
  /** Plain-words reason when it didn't go (reasonLabel). */
  reason: string | null;
  /** "8:00 AM" when held for quiet hours. */
  sendAtLabel: string | null;
  /** The text card is in the sender's own outbox (tap to send from this phone). */
  mine: boolean;
}

export interface SendCopy {
  tone: "success" | "info" | "warning" | "error";
  title: string;
  detail: string | null;
}

const isText = (c: string) => c === "sms" || c === "whatsapp";

/**
 * The send sheet's result, instead of a blind "Invoice sent" toast:
 * "Ready to text", "Emailed to sophia@…", "Not sent: Sophia opted out of texts",
 * "Will send at 8:00 AM (quiet hours)".
 */
export function describeSend(
  o: SendOutcome,
  who: { firstName: string; what?: string },
): SendCopy {
  const what = who.what ?? "invoice";
  const to = o.to ? ` to ${o.to}` : "";
  switch (o.status) {
    case "pending_tap":
      return o.mine
        ? {
            tone: "info",
            title: "Ready to text",
            detail: "Tap Send to text it from your phone.",
          }
        : {
            tone: "info",
            title: "Waiting in the office outbox",
            detail: `The office texts the ${what} to ${who.firstName} from there.`,
          };
    case "scheduled":
    case "sent":
    case "delivered":
    case "sent_manual":
      return isText(o.channel)
        ? { tone: "success", title: `Texted${to}`, detail: null }
        : { tone: "success", title: `Emailed${to}`, detail: null };
    case "deferred_quiet":
      return {
        tone: "warning",
        title: o.sendAtLabel
          ? `Will send at ${o.sendAtLabel}`
          : "Will send in the morning",
        detail: "Held for quiet hours.",
      };
    case "suppressed_optout":
      return {
        tone: "error",
        title: "Not sent",
        detail: isText(o.channel)
          ? `${who.firstName} opted out of texts. Try email.`
          : (o.reason ?? `${who.firstName} asked not to be contacted.`),
      };
    case "skipped":
    case "failed":
    case "canceled":
    case "expired":
      return {
        tone: "error",
        title: "Not sent",
        detail: o.reason ?? "This message couldn't go out.",
      };
  }
}
