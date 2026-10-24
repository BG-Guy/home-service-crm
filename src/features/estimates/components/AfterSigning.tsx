"use client";

import { CalendarClock, CreditCard, Send, Wrench } from "lucide-react";
import { useState, useTransition } from "react";
import { sendDepositLink } from "@/features/payments/actions";
import { CollectPaymentButton } from "@/features/payments/slots.client";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { moveEstimateBack, scheduleEstimateLater } from "../actions";

// After signing (Quote to Paid E5): "When is the work?" — now, on this visit (the
// lines are on this job's invoice) or schedule later (they move to an unscheduled
// follow-up job the office books; reversible while it's unbooked and unpaid) —
// then the deposit: collect it now, text a pay link, or not now. A lazy island:
// only approved estimates load it.

export interface AfterSigningProps {
  estimateId: string;
  mode: "now" | "later";
  /** The job the work is on now, and (later) the visit it was signed on. */
  job: { id: string; number: string } | null;
  originJob: { id: string; number: string } | null;
  canScheduleLater: boolean;
  canMoveBack: boolean;
  locked: string | null;
  deposit: { id: string; amountCents: number } | null;
  canCollect: boolean;
}

export function AfterSigning({
  estimateId,
  mode,
  job,
  originJob,
  canScheduleLater,
  canMoveBack,
  locked,
  deposit,
  canCollect,
}: AfterSigningProps) {
  const [pending, start] = useTransition();
  const [sending, startSend] = useTransition();
  const [depositHidden, setDepositHidden] = useState(false);

  const moveBack = () =>
    start(async () => {
      const r = await moveEstimateBack({ estimateId });
      toast(
        r.ok
          ? { title: "The work is back on this visit", tone: "success" }
          : { title: r.error, tone: "error" },
      );
    });
  const later = () =>
    start(async () => {
      const r = await scheduleEstimateLater({ estimateId });
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({
        title: `Moved to follow-up ${r.data?.number ?? ""}`.trim(),
        tone: "success",
        action: { label: "Move it back", onPress: moveBack },
      });
    });
  const choices = [
    {
      key: "now" as const,
      title: "Now, on this visit",
      sub:
        mode === "later" && originJob
          ? `Move the lines back to ${originJob.number}'s invoice`
          : "The lines go on this job's invoice",
      Icon: Wrench,
      onPick: canMoveBack ? moveBack : undefined,
    },
    {
      key: "later" as const,
      title: "Schedule later",
      sub:
        mode === "later" && job
          ? `On follow-up ${job.number}: the office books the visit`
          : "The office books the visit",
      Icon: CalendarClock,
      onPick: canScheduleLater ? later : undefined,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="work-when" className="flex flex-col gap-2">
        <h2
          id="work-when"
          className="px-1 text-footnote font-semibold uppercase text-label-2"
          style={{ letterSpacing: "0.04em" }}
        >
          When is the work?
        </h2>
        <div
          role="radiogroup"
          aria-labelledby="work-when"
          className="flex flex-col gap-2"
        >
          {choices.map((c) => {
            const on = c.key === mode;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a radio card, not a form input
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!on && (!c.onPick || pending)}
                onClick={on ? undefined : c.onPick}
                className={cx(
                  "pressable flex min-h-14 items-center gap-3 rounded-card bg-card px-4 py-3 text-left shadow-card outline-offset-2 disabled:opacity-60",
                  on && "ring-2 ring-accent",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    on
                      ? "bg-accent-fill"
                      : "shadow-[inset_0_0_0_2px_var(--label-3)]",
                  )}
                >
                  {on ? (
                    <span className="size-2.5 rounded-full bg-white" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-headline">{c.title}</span>
                  <span className="block text-subhead text-label-2">
                    {c.sub}
                  </span>
                </span>
                <c.Icon
                  aria-hidden
                  size={20}
                  className="shrink-0 text-label-2"
                />
              </button>
            );
          })}
        </div>
        {mode === "later" && canMoveBack && originJob ? (
          <Button
            variant="plain"
            size="sm"
            className="self-start"
            loading={pending}
            onClick={moveBack}
          >
            Move it back to {originJob.number}
          </Button>
        ) : null}
        {locked ? (
          <p className="px-1 text-footnote text-label-2">{locked}</p>
        ) : null}
      </section>

      {deposit && !depositHidden ? (
        <section
          aria-label="Deposit"
          className="flex flex-col gap-3 rounded-card p-4"
          style={{
            background:
              "color-mix(in srgb, var(--sys-green) var(--tint-a), var(--card))",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-white"
              style={{
                background: "linear-gradient(145deg, #3fc26a, #23863c)",
              }}
            >
              <CreditCard size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="num text-headline">
                Deposit {formatMoney(deposit.amountCents)}
              </p>
              <p className="text-subhead text-label-2">
                Comes off the invoice by itself
              </p>
            </div>
          </div>
          {canCollect ? (
            <div className="flex flex-col gap-2">
              {job ? (
                <CollectPaymentButton
                  jobId={job.id}
                  allowDeposit
                  defaultTarget="deposit"
                  size="lg"
                  fullWidth
                  label={`Collect ${formatMoney(deposit.amountCents)} deposit`}
                />
              ) : null}
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  icon={<Send size={17} aria-hidden />}
                  loading={sending}
                  onClick={() =>
                    startSend(async () => {
                      const r = await sendDepositLink({
                        depositRequestId: deposit.id,
                      });
                      toast(
                        r.ok
                          ? { title: "Pay link sent", tone: "success" }
                          : { title: r.error, tone: "error" },
                      );
                    })
                  }
                >
                  Text a pay link
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setDepositHidden(true)}
                >
                  Not now
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-footnote text-label-2">
              The office collects the deposit.
            </p>
          )}
        </section>
      ) : deposit ? (
        <p className="flex items-center justify-between gap-3 px-1 text-subhead text-label-2">
          <span className="num">
            Deposit {formatMoney(deposit.amountCents)} still open
          </span>
          <Button
            variant="plain"
            size="sm"
            onClick={() => setDepositHidden(false)}
          >
            Collect it
          </Button>
        </p>
      ) : null}
    </div>
  );
}
