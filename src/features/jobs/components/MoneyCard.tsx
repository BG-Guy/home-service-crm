import {
  Check,
  ChevronRight,
  CircleCheck,
  CreditCard,
  FileText,
  type LucideIcon,
  Minus,
  Plus,
  Receipt,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { STAGE_FILL, type StageColor, stageStyle } from "@/lib/stage-colors";
import { Button } from "@/ui/components/Button";
import { cx } from "@/ui/cx";
import type {
  MoneyAction,
  MoneyStage,
  MoneyStageKey,
  MoneyStepState,
} from "../money-stage";
import {
  LazyCollectPaymentButton as CollectPaymentButton,
  LazyPresentButton as PresentButton,
  LazySignOffButton as SignOffButton,
} from "./lazy-islands";

// The job's money card (Quote to Paid, "progress rail"; mockup step3-4): the five
// stages, where the money stands and ONE main button for the next step, in the
// current stage's color. A server component: the links render as plain anchors;
// Present and the sign-off are small lazy islands; Collect reuses the payments
// slot already on the page.

const STEP_ICON: Record<MoneyStageKey, LucideIcon> = {
  estimate: FileText,
  present: Sparkles,
  deposit: CreditCard,
  invoice: Receipt,
  paid: Check,
};

const STATE_WORD: Record<MoneyStepState, string> = {
  done: "done",
  now: "next step",
  todo: "to do",
  skipped: "skipped",
};

/** Done checks are paid green on every stage; "now" wears the stage color. */
function circleStyle(state: MoneyStepState): CSSProperties {
  if (state === "done") return { background: STAGE_FILL.paid, color: "#fff" };
  if (state === "now")
    return {
      background: "var(--accent-fill)",
      color: "var(--on-accent)",
      boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent)",
    };
  if (state === "skipped")
    return { background: "var(--fill-2)", color: "var(--label-3)" };
  return { background: "var(--fill)", color: "var(--label-3)" };
}

function Rail({ stage }: { stage: MoneyStage }) {
  const reached = stage.steps.findIndex((s) => s.state === "now");
  const upTo = reached < 0 ? stage.steps.length : reached;
  return (
    <ol aria-label="Money progress" className="flex">
      {stage.steps.map((s, i) => {
        const Icon =
          s.state === "done"
            ? Check
            : s.state === "skipped"
              ? Minus
              : STEP_ICON[s.key];
        return (
          <li
            key={s.key}
            aria-current={s.state === "now" ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1"
          >
            {i > 0 && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  top: 13,
                  right: "50%",
                  width: "100%",
                  height: 2,
                  borderRadius: 1,
                  background: i <= upTo ? STAGE_FILL.paid : "var(--fill)",
                }}
              />
            )}
            <span
              aria-hidden
              className="relative flex size-7 items-center justify-center rounded-full"
              style={circleStyle(s.state)}
            >
              <Icon size={15} strokeWidth={2.4} />
            </span>
            <span
              className={cx(
                "whitespace-nowrap text-footnote",
                s.state === "now"
                  ? "font-semibold text-label"
                  : s.state === "done"
                    ? "text-label-2"
                    : "text-label-3",
              )}
            >
              {s.label}
              <span className="sr-only">: {STATE_WORD[s.state]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface MoneyCardCan {
  /** Create or finish an estimate (estimates.create, flag on). */
  estimate: boolean;
  /** Present an estimate (estimates.send). */
  present: boolean;
  /** Take a deposit (payments.collect or record_manual). */
  collect: boolean;
  /** Open the invoice page (invoices.view). */
  invoice: boolean;
}

function MainButton({
  jobId,
  next,
  can,
}: {
  jobId: string;
  next: MoneyAction;
  can: MoneyCardCan;
}): ReactNode {
  const link = (href: string, icon: ReactNode, prefetch?: boolean) => (
    <Button
      href={href}
      size="lg"
      block
      transition="push"
      prefetch={prefetch}
      icon={icon}
    >
      {next.label}
    </Button>
  );
  switch (next.kind) {
    case "create_estimate":
      // The new-estimate page creates the draft at once: never prefetch it.
      return can.estimate
        ? link(
            `/estimates/new?jobId=${jobId}`,
            <Plus size={20} aria-hidden />,
            false,
          )
        : null;
    case "finish_estimate":
      return can.estimate
        ? link(
            `/estimates/${next.estimateId}`,
            <FileText size={20} aria-hidden />,
          )
        : null;
    case "present":
      return can.present ? (
        <PresentButton estimateId={next.estimateId} label={next.label} />
      ) : null;
    case "collect_deposit":
      return can.collect ? (
        <CollectPaymentButton
          jobId={jobId}
          allowDeposit
          defaultTarget="deposit"
          label={next.label}
          size="lg"
          fullWidth
        />
      ) : null;
    case "invoice_now":
      return can.invoice
        ? link(
            next.invoiceId
              ? `/invoices/${next.invoiceId}`
              : `/jobs/${jobId}?tab=invoice`,
            <Receipt size={20} aria-hidden />,
          )
        : null;
    case "get_paid":
      return can.invoice
        ? link(
            `/invoices/${next.invoiceId}`,
            <CreditCard size={20} aria-hidden />,
          )
        : null;
    case "send_receipt":
      return can.invoice
        ? link(`/invoices/${next.invoiceId}`, <Send size={20} aria-hidden />)
        : null;
    case "open_invoice":
      return can.invoice
        ? link(`/invoices/${next.invoiceId}`, <Receipt size={20} aria-hidden />)
        : null;
  }
}

/** Customer sign-off (the work is done): the row offering it, or who signed and when. */
export type MoneyCardSignOff =
  | { signed: true; text: string }
  | {
      signed: false;
      customerName: string;
      consentText: string;
      summaryLines: string[];
    };

/** The card's look: a wash of the stage color from the top-left corner. */
function cardStyle(color: StageColor): CSSProperties {
  return {
    ...stageStyle(color),
    background:
      "linear-gradient(160deg, color-mix(in srgb, var(--accent) 11%, var(--card)), var(--card) 62%)",
    boxShadow:
      "var(--shadow-card), inset 0 0 0 0.5px color-mix(in srgb, var(--accent) 22%, transparent)",
  };
}

export function MoneyCard({
  jobId,
  stage,
  can,
  signOff,
}: {
  jobId: string;
  stage: MoneyStage;
  can: MoneyCardCan;
  signOff?: MoneyCardSignOff | null;
}) {
  const main = stage.next ? (
    <MainButton jobId={jobId} next={stage.next} can={can} />
  ) : null;
  return (
    <section
      aria-labelledby="job-money"
      className="card flex flex-col gap-4 p-4 sm:p-5"
      style={cardStyle(stage.color)}
    >
      <h2 id="job-money" className="sr-only">
        Money
      </h2>
      <Rail stage={stage} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-headline">{stage.summary}</p>
          {stage.detail && (
            <p className="mt-0.5 text-subhead text-label-2">{stage.detail}</p>
          )}
        </div>
        <Link
          href={`/jobs/${jobId}?tab=invoice`}
          replace
          scroll={false}
          className="hit-44 flex shrink-0 items-center text-subhead font-semibold text-accent-text"
        >
          All money
          <ChevronRight size={16} aria-hidden />
        </Link>
      </div>
      {main}
      {signOff?.signed ? (
        <p className="flex min-h-11 items-center gap-3 border-hairline border-t pt-3 text-subhead">
          <CircleCheck
            size={20}
            aria-hidden
            className="shrink-0"
            style={{ color: "var(--ink-green)" }}
          />
          {signOff.text}
        </p>
      ) : signOff ? (
        <SignOffButton
          jobId={jobId}
          customerName={signOff.customerName}
          consentText={signOff.consentText}
          summaryLines={signOff.summaryLines}
        />
      ) : null}
    </section>
  );
}

/**
 * A soft wash of the stage color behind the top of the job page (color by stage).
 * Absolutely placed in a `relative` wrapper, before the content.
 */
export function StageWash({ color }: { color: StageColor }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{
        height: 340,
        background: `linear-gradient(180deg, color-mix(in srgb, ${STAGE_FILL[color]} 18%, transparent), transparent)`,
      }}
    />
  );
}
