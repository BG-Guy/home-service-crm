"use client";

import {
  CheckCircle2,
  Download,
  Landmark,
  Lock,
  PlusCircle,
  ShieldCheck,
} from "lucide-react";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { DateField } from "@/ui/components/DatePicker";
import { Select, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  approveStatement,
  closePeriodNow,
  closeStatement,
  exportNachaAction,
  markBankVerified,
  postAdjustment,
  recordPayoutAction,
  reviewLedgerEntry,
} from "../actions";
import { isBusinessDay, nextBusinessDay } from "../engine/periods";

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fail = (title: string, error: string) =>
  toast({ title, message: error, tone: "error" });

/** Apply or waive a W-2 needs_review deduction. */
export function ReviewEntryButtons({
  ledgerEntryId,
}: {
  ledgerEntryId: string;
}) {
  const [pending, start] = useTransition();
  const go = (decision: "apply" | "waive") =>
    start(async () => {
      const r = await reviewLedgerEntry({ ledgerEntryId, decision });
      if (!r.ok) fail("Couldn't save", r.error);
      else
        toast({
          title:
            decision === "apply" ? "Deduction applied" : "Deduction waived",
          tone: "success",
        });
    });
  return (
    <span className="flex gap-1 print:hidden">
      <Button
        size="sm"
        variant="tinted"
        loading={pending}
        onClick={() => go("apply")}
      >
        Apply
      </Button>
      <Button
        size="sm"
        variant="plain"
        disabled={pending}
        onClick={() => go("waive")}
      >
        Waive
      </Button>
    </span>
  );
}

/** Approve (payroll.approve); confirms an early approval while the tech review window is open. */
export function ApproveButton({
  settlementId,
  inReview,
  disabledReason,
}: {
  settlementId: string;
  inReview: boolean;
  disabledReason?: string | null;
}) {
  const [confirm, el] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      {el}
      <Button
        icon={<CheckCircle2 size={18} aria-hidden />}
        loading={pending}
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
        onClick={async () => {
          if (
            inReview &&
            !(await confirm({
              title: "Approve before the review window ends?",
              message:
                "The tech still has time to flag lines. Approve now only if you've talked to them.",
              confirmLabel: "Approve now",
            }))
          )
            return;
          start(async () => {
            const r = await approveStatement({ settlementId, force: inReview });
            if (!r.ok) fail("Couldn't approve", r.error);
            else toast({ title: "Statement approved", tone: "success" });
          });
        }}
      >
        Approve
      </Button>
    </>
  );
}

/** Record a payout ("paycheck deposit"): method, reference, date, proof, amount. */
export function RecordPayoutButton({
  userId,
  settlementIds,
  owedCents,
  name,
  hasBank,
}: {
  userId: string;
  settlementIds: string[];
  owedCents: number;
  name: string;
  hasBank: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(hasBank ? "ach_nacha" : "zelle");
  const [amount, setAmount] = useState<number | null>(owedCents);
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayKey);
  const [proof, setProof] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="tinted"
        icon={<Landmark size={18} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Record payout
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Record payout"
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!amount}
            onClick={() =>
              start(async () => {
                const r = await recordPayoutAction({
                  userId,
                  settlementIds,
                  method: method as "zelle",
                  amountCents: amount ?? 0,
                  reference: reference || null,
                  paidOn,
                  proofMediaId: proof,
                });
                if (!r.ok) {
                  setError(r.fieldErrors?.amountCents?.[0] ?? r.error);
                  return;
                }
                toast({
                  title: `Payout recorded`,
                  message: `${name} is notified.`,
                  tone: "success",
                });
                setOpen(false);
              })
            }
          >
            Record {amount ? formatMoney(amount) : "payout"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-6 pt-1">
          <p className="text-subhead text-label-2">
            {name} is owed {formatMoney(owedCents)}. Record the payment you
            sent; nothing is sent from here.
          </p>
          <Select
            label="Method"
            value={method}
            onChange={(e) => setMethod(e.currentTarget.value)}
            options={[
              { value: "ach_nacha", label: "Direct deposit (ACH)" },
              { value: "zelle", label: "Zelle" },
              { value: "check", label: "Check" },
              { value: "cash", label: "Cash" },
              {
                value: "payroll_provider",
                label: "Payroll provider (Gusto, ADP…)",
              },
              { value: "other", label: "Other" },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <MoneyField
              label="Amount"
              valueCents={amount}
              onChangeCents={setAmount}
              error={error}
            />
            <DateField
              label="Paid on"
              value={paidOn}
              onChange={(e) => setPaidOn(e.currentTarget.value)}
            />
          </div>
          <TextField
            label="Reference"
            placeholder={method === "check" ? "Check #" : "Confirmation #"}
            value={reference}
            onChange={(e) => setReference(e.currentTarget.value)}
          />
          <CameraButton
            kind="document"
            tag="document"
            label={proof ? "Proof attached" : "Proof (optional)"}
            multiple={false}
            onUploaded={(r) => setProof(r.mediaId)}
            onError={(e) => fail("Photo failed", e.message)}
          />
        </div>
      </Sheet>
    </>
  );
}

export function CloseNoPayoutButton({
  settlementId,
}: {
  settlementId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="gray"
      icon={<Lock size={18} aria-hidden />}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await closeStatement({ settlementId });
          if (!r.ok) fail("Couldn't close", r.error);
          else
            toast({
              title: "Statement closed",
              message: "The balance carries forward.",
              tone: "success",
            });
        })
      }
    >
      Close (nothing to pay)
    </Button>
  );
}

/** Admin confirmed new bank details by phone → lift the payout hold. */
export function MarkVerifiedButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [confirm, el] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      {el}
      <Button
        size="sm"
        variant="tinted"
        icon={<ShieldCheck size={16} aria-hidden />}
        loading={pending}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Verified ${name}'s new bank details?`,
              message:
                "Only confirm after calling them on a number you already had. Payroll diversion scams start with an email asking to change bank details.",
              confirmLabel: "Verified by phone",
            }))
          )
            return;
          start(async () => {
            const r = await markBankVerified({ userId });
            if (!r.ok) fail("Couldn't save", r.error);
            else toast({ title: "Bank details verified", tone: "success" });
          });
        }}
      >
        Verified
      </Button>
    </>
  );
}

/** Manual adjustment (payroll.manage). */
export function AdjustmentButton({
  userId,
  settlementId,
  defaultDate,
}: {
  userId: string;
  settlementId?: string | null;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  return (
    <>
      <Button
        variant="gray"
        icon={<PlusCircle size={18} aria-hidden />}
        onClick={() => setOpen(true)}
      >
        Adjustment
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Pay adjustment"
        detents={["content"]}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!amount || memo.trim().length < 3}
            onClick={() =>
              start(async () => {
                const r = await postAdjustment({
                  userId,
                  amountCents: amount ?? 0,
                  memo,
                  effectiveDate: date,
                  settlementId: settlementId ?? null,
                });
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? { memo: [r.error] });
                  return;
                }
                toast({ title: "Adjustment posted", tone: "success" });
                setOpen(false);
                setAmount(null);
                setMemo("");
              })
            }
          >
            Post adjustment
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          <MoneyField
            label="Amount (+ owed to tech, − owed by tech)"
            allowNegative
            valueCents={amount}
            onChangeCents={setAmount}
            error={errors?.amountCents?.[0]}
          />
          <TextField
            label="Reason"
            value={memo}
            onChange={(e) => setMemo(e.currentTarget.value)}
            error={errors?.memo?.[0]}
            placeholder="e.g. Missed spiff for J-1042"
          />
          <DateField
            label="Effective date"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
        </div>
      </Sheet>
    </>
  );
}

export function ClosePeriodButton({
  payPeriodId,
  label,
}: {
  payPeriodId: string;
  label: string;
}) {
  const [confirm, el] = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      {el}
      <Button
        size="sm"
        variant="tinted"
        loading={pending}
        onClick={async () => {
          if (
            !(await confirm({
              title: `Close ${label} now?`,
              message:
                "Statements are drafted and sent to techs for their 48-hour review.",
              confirmLabel: "Close period",
            }))
          )
            return;
          start(async () => {
            const r = await closePeriodNow({ payPeriodId });
            if (!r.ok) fail("Couldn't close", r.error);
            else
              toast({
                title: "Period closed",
                message: `${r.data?.created ?? 0} statements drafted.`,
                tone: "success",
              });
          });
        }}
      >
        Close now
      </Button>
    </>
  );
}

/** NACHA (PPD/CCD) export for approved, owed statements; bank-change holds are excluded. */
export function NachaExportButton({
  candidates,
  enabled,
}: {
  candidates: {
    id: string;
    name: string;
    owedCents: number;
    hasBank: boolean;
    bankHold: boolean;
  }[];
  enabled: boolean;
}) {
  const ok = candidates.filter((c) => c.hasBank && !c.bankHold);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => nextBusinessDay(todayKey()));
  const [selected, setSelected] = useState<string[]>(ok.map((c) => c.id));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    batchId: string;
    filename: string;
    excluded: { name: string; reason: string }[];
  } | null>(null);
  if (!enabled) return null;
  const total = candidates
    .filter((c) => selected.includes(c.id))
    .reduce((a, c) => a + c.owedCents, 0);
  return (
    <>
      <Button
        variant="tinted"
        icon={<Download size={18} aria-hidden />}
        disabled={ok.length === 0}
        onClick={() => setOpen(true)}
      >
        NACHA file
      </Button>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setResult(null);
        }}
        title="Direct deposit file"
        detents={["large"]}
        footer={
          result ? (
            <Button
              href={`/pay/settlements/nacha/${result.batchId}`}
              size="lg"
              fullWidth
              icon={<Download size={18} aria-hidden />}
            >
              Download {result.filename}
            </Button>
          ) : (
            <Button
              size="lg"
              fullWidth
              loading={pending}
              disabled={selected.length === 0 || !date || !isBusinessDay(date)}
              onClick={() =>
                start(async () => {
                  const r = await exportNachaAction({
                    settlementIds: selected,
                    effectiveDate: date,
                  });
                  if (!r.ok) {
                    fail("Couldn't build the file", r.error);
                    return;
                  }
                  setResult(r.data ?? null);
                  toast({
                    title: "NACHA file ready",
                    message:
                      "Payouts were recorded for each person in the file.",
                    tone: "success",
                  });
                })
              }
            >
              Build file · {formatMoney(total)}
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-3 pb-6 pt-1">
          {result ? (
            <>
              <p className="text-body">
                Upload the file to your bank&apos;s ACH portal. Each payout is
                recorded as direct deposit.
              </p>
              {result.excluded.length > 0 && (
                <p className="text-footnote text-label-2">
                  Left out:{" "}
                  {result.excluded
                    .map((x) => `${x.name} (${x.reason.replace(/_/g, " ")})`)
                    .join(", ")}
                </p>
              )}
            </>
          ) : (
            <>
              <DateField
                label="Settlement (effective) date"
                value={date}
                onChange={(e) => setDate(e.currentTarget.value)}
                error={
                  date && !isBusinessDay(date)
                    ? "Banks settle ACH Monday to Friday. Pick a weekday."
                    : null
                }
                hint="Usually the next business day."
              />
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-footnote font-semibold uppercase text-label-2">
                  Include
                </legend>
                {candidates.map((c) => {
                  const blocked = !c.hasBank || c.bankHold;
                  return (
                    <label
                      key={c.id}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-sep py-1"
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="size-5 accent-[var(--accent)]"
                          disabled={blocked}
                          checked={selected.includes(c.id)}
                          onChange={(e) => {
                            const on = e.currentTarget.checked;
                            setSelected((s) =>
                              on ? [...s, c.id] : s.filter((x) => x !== c.id),
                            );
                          }}
                        />
                        <span>
                          {c.name}
                          {blocked && (
                            <span className="block text-footnote text-danger">
                              {!c.hasBank
                                ? "No bank details"
                                : "Bank changed recently: on hold until verified"}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="num">{formatMoney(c.owedCents)}</span>
                    </label>
                  );
                })}
              </fieldset>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
