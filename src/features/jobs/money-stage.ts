// Where a job's money stands (Quote to Paid, "progress rail"): five stages from the
// estimate to paid, each done / now / todo / skipped, the current stage's color, a
// summary for the money card and the ONE next step its main button offers.
// Pure and isomorphic (server pages and client cards); golden-tested in
// tests/golden/money-stage.test.ts. The facts come from jobs/money-reads.ts.
import { formatMoney } from "@/lib/money";
import type { StageColor } from "@/lib/stage-colors";
import { dateKey, formatInTz } from "@/lib/time";

export const MONEY_STAGES = [
  "estimate",
  "present",
  "deposit",
  "invoice",
  "paid",
] as const;
export type MoneyStageKey = (typeof MONEY_STAGES)[number];
export type MoneyStepState = "done" | "now" | "todo" | "skipped";

export const MONEY_STAGE_LABEL: Record<MoneyStageKey, string> = {
  estimate: "Estimate",
  present: "Present",
  deposit: "Deposit",
  invoice: "Invoice",
  paid: "Paid",
};

const STAGE_COLOR: Record<MoneyStageKey, StageColor> = {
  estimate: "estimate",
  present: "estimate",
  deposit: "invoice",
  invoice: "invoice",
  paid: "paid",
};

/**
 * The pill tone of a stage color (job cards): the same AA inks stageStyle uses
 * (--ink-indigo / --ink-blue / --ink-green), so a small pill needs no new style.
 */
export const STAGE_TONE: Record<StageColor, "indigo" | "blue" | "green"> = {
  estimate: "indigo",
  invoice: "blue",
  paid: "green",
};

/** Estimates still in play. Every other status (declined, expired, superseded…) is closed. */
const OPEN_ESTIMATE = new Set(["draft", "sent", "viewed"]);
const DEPOSIT_DUE = new Set(["required", "requested"]);
const DEPOSIT_DONE = new Set(["paid", "held", "applied"]);
const WORK_DONE = new Set(["completed", "closed"]);

export interface MoneyEstimate {
  id: string;
  number: string;
  status: string;
  /** Any option has at least one line. */
  hasLines: boolean;
  optionCount: number;
  /** Headline total: the approved option, else the recommended, else the highest (tax incl.). */
  totalCents: number;
  /** The cheapest option with lines ("From $310.36"). */
  fromCents: number;
  /** The approved option's name ("Better"). */
  approvedLabel: string | null;
  /** The recommended option's name. */
  recommendedLabel: string | null;
  sentAt?: Date | string | null;
  viewedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  createdAt: Date | string;
}

export interface MoneyDeposit {
  amountCents: number;
  /** required | requested | paid | held | applied | waived | expired | refunded | forfeited */
  status: string;
}

/** The job's latest invoice that isn't void. */
export interface MoneyInvoice {
  id: string;
  number: string;
  /** draft | issued | partially_paid | paid | uncollectible */
  status: string;
  totalCents: number;
  balanceCents: number;
  /** Real lines: the lead's quoted-price placeholder doesn't count. */
  hasLines: boolean;
}

export interface MoneyFacts {
  jobStatus: string;
  /** jobs.payment_status: none | deposit_paid | partial | paid | refunded | disputed */
  paymentStatus: string;
  estimatesOn: boolean;
  customerFirstName: string | null;
  estimates: readonly MoneyEstimate[];
  /** The deposit request that counts (an open one first, else the newest settled one). */
  deposit: MoneyDeposit | null;
  invoice: MoneyInvoice | null;
  /** Paid on the job net of refunds, deposits included (tips excluded). */
  paidCents: number;
  /** The part of `paidCents` paid as deposits. */
  depositPaidCents: number;
  /** Tips on the job's payments (the paid summary). */
  tipCents?: number;
}

export type MoneyAction =
  | { kind: "create_estimate"; label: string }
  | { kind: "finish_estimate"; label: string; estimateId: string }
  | { kind: "present"; label: string; estimateId: string }
  | { kind: "collect_deposit"; label: string; amountCents: number }
  | { kind: "invoice_now"; label: string; invoiceId: string | null }
  | { kind: "get_paid"; label: string; invoiceId: string }
  | { kind: "send_receipt"; label: string; invoiceId: string }
  | { kind: "open_invoice"; label: string; invoiceId: string };

export interface MoneyStep {
  key: MoneyStageKey;
  label: string;
  state: MoneyStepState;
}

export interface MoneyStage {
  steps: MoneyStep[];
  /** The stage that's "now"; "paid" once everything is done. */
  current: MoneyStageKey;
  /** Color by stage: estimate (Estimate, Present), invoice (Deposit, Invoice), paid. */
  color: StageColor;
  /** The card's bold line ("Approved · $450.73"). */
  summary: string;
  /** The quiet line under it ("Better · signed 2:41 PM"). */
  detail: string | null;
  /** The one main button; null on a cancelled job or when nothing is left to do. */
  next: MoneyAction | null;
  /** A short label for job cards ("Estimate sent", "$360.73 due", "Paid"); null when there's nothing to say. */
  badge: string | null;
}

const ms = (d: Date | string | null | undefined) =>
  d == null ? 0 : new Date(d).getTime();

function newest<T>(list: readonly T[], at: (x: T) => number): T | null {
  let best: T | null = null;
  for (const x of list) if (!best || at(x) > at(best)) best = x;
  return best;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const join = (parts: (string | null | false | undefined)[]) =>
  cap(parts.filter(Boolean).join(" · "));

/** Words for an estimate that's no longer in play. */
function closedWord(status: string): string {
  if (status === "superseded") return "replaced";
  return status.replace(/_/g, " ");
}

/**
 * The money rail and next step for one job. `tz` and `now` format the times
 * ("signed 2:41 PM" today, "signed Oct 21" before).
 */
export function moneyStage(
  f: MoneyFacts,
  opts: { tz: string; now?: Date },
): MoneyStage {
  const now = opts.now ?? new Date();
  const money = (c: number) => formatMoney(c);
  const whole = (c: number) => formatMoney(c, { compactWhole: true });
  const when = (d: Date | string | null | undefined): string | null => {
    if (d == null) return null;
    return dateKey(d, opts.tz) === dateKey(now, opts.tz)
      ? formatInTz(d, opts.tz, { hour: "numeric", minute: "2-digit" })
      : formatInTz(d, opts.tz, { month: "short", day: "numeric" });
  };

  const ests = f.estimatesOn ? f.estimates : [];
  const approved = newest(
    ests.filter((e) => e.status === "approved"),
    (e) => ms(e.approvedAt) || ms(e.createdAt),
  );
  const open = newest(
    ests.filter((e) => OPEN_ESTIMATE.has(e.status)),
    (e) => ms(e.createdAt),
  );
  const closed =
    approved || open
      ? null
      : newest(
          ests.filter(
            (e) => !OPEN_ESTIMATE.has(e.status) && e.status !== "approved",
          ),
          (e) => ms(e.createdAt),
        );

  const inv = f.invoice && f.invoice.status !== "void" ? f.invoice : null;
  const issued = !!inv && inv.status !== "draft";
  const disputed = f.paymentStatus === "disputed";
  const refunded = f.paymentStatus === "refunded";
  const paid =
    !disputed &&
    !refunded &&
    (f.paymentStatus === "paid" || inv?.status === "paid");
  const dep = f.deposit;
  const depositDone = !!dep && DEPOSIT_DONE.has(dep.status);
  const depositDue = !!dep && DEPOSIT_DUE.has(dep.status);
  const workDone = WORK_DONE.has(f.jobStatus);

  // A quick job (a lockout): no estimate, and the money already moved without
  // one (lines added straight to the invoice, a payment, the work done).
  const quick =
    (!!inv && (inv.hasLines || issued)) ||
    f.paidCents > f.depositPaidCents ||
    workDone ||
    f.jobStatus === "cancelled";
  const skipEstimates = !f.estimatesOn || (!approved && !open && quick);

  const done: Record<MoneyStageKey, boolean> = {
    estimate: !!approved || !!open?.hasLines,
    present: !!approved,
    deposit: depositDone,
    invoice: issued || paid,
    paid,
  };
  const skipped: Record<MoneyStageKey, boolean> = {
    estimate: skipEstimates,
    present: skipEstimates,
    // No deposit rule (or it was waived, expired…); a deposit still open once
    // the work is done is moot: the balance is billed.
    deposit: !depositDone && (!depositDue || workDone),
    invoice: false,
    paid: false,
  };
  // Once billed, whatever was left before the bill was skipped (an estimate
  // never presented, a deposit never taken).
  if (issued || paid)
    for (const k of ["estimate", "present", "deposit"] as const)
      if (!done[k]) skipped[k] = true;

  let current: MoneyStageKey | null = null;
  const steps: MoneyStep[] = [];
  for (const key of MONEY_STAGES) {
    let state: MoneyStepState;
    if (done[key]) state = "done";
    else if (skipped[key]) state = "skipped";
    else if (current == null) {
      state = "now";
      current = key;
    } else state = "todo";
    steps.push({ key, label: MONEY_STAGE_LABEL[key], state });
  }
  const cur: MoneyStageKey = current ?? "paid";
  const settled = cur === "paid" && paid;
  const color: StageColor =
    cur === "paid" && !paid ? "invoice" : STAGE_COLOR[cur];

  const approvedDetail = (e: MoneyEstimate) =>
    join([
      e.optionCount > 1 && e.approvedLabel,
      e.approvedAt && `signed ${when(e.approvedAt)}`,
    ]) || null;

  let summary = "";
  let detail: string | null = null;
  let next: MoneyAction | null = null;
  let badge: string | null = null;

  if (cur === "estimate") {
    if (open) {
      summary = `${open.number} has no items yet`;
      detail = "Add items from the price book";
      next = {
        kind: "finish_estimate",
        label: "Finish estimate",
        estimateId: open.id,
      };
      badge = "Estimate draft";
    } else if (closed) {
      summary = `${closed.number} ${closedWord(closed.status)}`;
      detail = "Make a new one when they're ready";
      next = { kind: "create_estimate", label: "Create estimate" };
      badge = `Estimate ${closedWord(closed.status)}`;
    } else {
      summary = "No estimate yet";
      detail = "Build it from the price book";
      next = { kind: "create_estimate", label: "Create estimate" };
    }
  } else if (cur === "present" && open) {
    const many = open.optionCount > 1;
    summary = many
      ? `${open.number} · ${open.optionCount} options`
      : `${open.number} · ${money(open.totalCents)}`;
    // Two facts at most, so the line fits a phone: whether the customer has
    // it (opened, sent) comes first, then the price.
    const seen =
      open.status === "viewed" && open.viewedAt
        ? `viewed ${when(open.viewedAt)}`
        : open.status === "sent" && open.sentAt
          ? `sent ${when(open.sentAt)}`
          : null;
    detail =
      join([
        seen,
        many && `from ${money(open.fromCents)}`,
        many &&
          !seen &&
          open.recommendedLabel &&
          `${open.recommendedLabel} recommended`,
      ]) || "Ready to present";
    const name = f.customerFirstName?.trim();
    next = {
      kind: "present",
      label: name ? `Present to ${name}` : "Present to customer",
      estimateId: open.id,
    };
    badge =
      open.status === "viewed"
        ? "Estimate viewed"
        : open.status === "sent"
          ? "Estimate sent"
          : "Estimate ready";
  } else if (cur === "deposit" && dep) {
    if (approved) {
      summary = `Approved · ${money(approved.totalCents)}`;
      detail = approvedDetail(approved);
    } else {
      summary = `${whole(dep.amountCents)} deposit due`;
      detail = "Collect it before the work starts";
    }
    next = {
      kind: "collect_deposit",
      label: `Collect ${whole(dep.amountCents)} deposit`,
      amountCents: dep.amountCents,
    };
    badge = "Deposit due";
  } else if (cur === "invoice") {
    const total =
      inv?.hasLines && inv.totalCents > 0
        ? inv.totalCents
        : (approved?.totalCents ?? 0);
    if (depositDone && dep) {
      const amount =
        f.depositPaidCents > 0 ? f.depositPaidCents : dep.amountCents;
      summary = `${whole(amount)} deposit ${dep.status === "held" ? "on hold" : "paid"}`;
      detail = join([
        f.jobStatus === "in_progress" && "work in progress",
        total > 0
          ? `${money(Math.max(0, total - amount))} left`
          : "add the work to the invoice",
      ]);
      badge = dep.status === "held" ? "Deposit on hold" : "Deposit paid";
    } else if (approved) {
      summary = `Approved · ${money(approved.totalCents)}`;
      detail = approvedDetail(approved);
      badge = "Approved";
    } else if (inv?.hasLines) {
      summary = `${inv.number} · ${money(inv.totalCents)}`;
      detail = "Draft, not sent yet";
      badge = "Invoice draft";
    } else {
      summary = "Nothing billed yet";
      detail = "Add the work to the invoice";
    }
    next = {
      kind: "invoice_now",
      label: "Invoice now",
      invoiceId: inv?.id ?? null,
    };
  } else if (cur === "paid" && inv) {
    if (disputed) {
      summary = "Chargeback open";
      detail = `${inv.number} · ${money(inv.totalCents)}`;
      next = { kind: "open_invoice", label: "Open invoice", invoiceId: inv.id };
    } else if (refunded) {
      summary = "Refunded";
      detail = `${inv.number} · ${money(inv.totalCents)}`;
      next = { kind: "open_invoice", label: "Open invoice", invoiceId: inv.id };
    } else if (settled) {
      if (inv.totalCents === 0) {
        summary = "No charge";
        detail = inv.number;
        badge = "No charge";
      } else {
        summary = `Paid in full · ${money(inv.totalCents)}`;
        detail = join([
          inv.number,
          (f.tipCents ?? 0) > 0 && `tip ${money(f.tipCents ?? 0)}`,
        ]);
        next = {
          kind: "send_receipt",
          label: "Send receipt",
          invoiceId: inv.id,
        };
        badge = "Paid";
      }
    } else if (inv.status === "uncollectible") {
      summary = `${inv.number} written off`;
      detail = `${money(inv.balanceCents)} uncollectible`;
      next = { kind: "open_invoice", label: "Open invoice", invoiceId: inv.id };
      badge = "Written off";
    } else {
      summary = `${inv.number} · ${money(inv.balanceCents)} due`;
      detail =
        f.paidCents > 0
          ? `${money(f.paidCents)} paid of ${money(inv.totalCents)}`
          : `Total ${money(inv.totalCents)}`;
      next = { kind: "get_paid", label: "Get paid", invoiceId: inv.id };
      badge = `${money(inv.balanceCents)} due`;
    }
  } else if (cur === "paid") {
    // Paid with no invoice on file (older data): say so plainly.
    summary = paid ? "Paid in full" : "Nothing billed yet";
    badge = paid ? "Paid" : null;
  }

  if (f.jobStatus === "cancelled") next = null;
  return { steps, current: cur, color, summary, detail, next, badge };
}
