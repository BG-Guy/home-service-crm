"use client";

import {
  Banknote,
  CircleEllipsis,
  Copy,
  CreditCard,
  ExternalLink,
  FileCheck2,
  Landmark,
  MessageSquare,
  QrCode,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import {
  type QueuedOutcome,
  SendResultView,
} from "@/features/invoices/components/SendResult";
import { formatMoney } from "@/lib/money";
import { qrSvg } from "@/lib/qr";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Skeleton } from "@/ui/components/Skeleton";
import { Pill } from "@/ui/components/StatusPill";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import {
  createPayLink,
  loadCollectContext,
  loadReceipt,
  receiptStatus,
  sendDepositLink,
  sendPayLink,
} from "../actions";
import { nothingDueMessage } from "../collect-copy";
import type {
  CollectContext,
  ReceiptAutoSend,
  ReceiptView,
} from "../contracts";
import { cashPriceCents, tipForPreset } from "../engine/fees";
import { offlineActions } from "../offline";
import { ReceiptSend, ReceiptSheet } from "./ReceiptSheet";

// Self-register until the integrator spreads every module into offline-registry.ts
// (idempotent; the outbox resolves "payments.recordManual" through the registry).
registerOfflineActions(offlineActions);

// The "Get paid" sheet body (S19/S20; Quote to Paid I2/I3): the amount big with
// one-tap tips, the methods as big tiles (pay on their phone by QR, cash, check,
// Zelle, Venmo), the main button in the sheet's sticky footer, and a success screen
// with the receipt. "Get paid" on a draft issues it first, in the same transaction
// as the payment (offline-safe: the outbox replays it with the same clientId).
// Loaded lazily by slots.client.tsx so none of it ships in a route's first bundle.

type Method = "card" | "cash" | "check" | "zelle" | "venmo" | "ach" | "other";
type Target = "balance" | "deposit" | "prepay";

const METHOD: Record<Method, { label: string; icon: ReactNode }> = {
  card: { label: "Card", icon: <CreditCard size={20} aria-hidden /> },
  cash: { label: "Cash", icon: <Banknote size={20} aria-hidden /> },
  check: { label: "Check", icon: <FileCheck2 size={20} aria-hidden /> },
  zelle: { label: "Zelle", icon: <Smartphone size={20} aria-hidden /> },
  venmo: { label: "Venmo", icon: <Smartphone size={20} aria-hidden /> },
  ach: { label: "Bank", icon: <Landmark size={20} aria-hidden /> },
  other: { label: "Other", icon: <CircleEllipsis size={20} aria-hidden /> },
};

/** "Record $61.29 by Zelle" / "$100.00 in cash": human method names, never the enum. */
const METHOD_PHRASE: Record<Method, string> = {
  card: "by card",
  cash: "in cash",
  check: "by check",
  zelle: "by Zelle",
  venmo: "by Venmo",
  ach: "by bank transfer",
  other: "(other method)",
};

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

interface Done {
  amountCents: number;
  tipCents: number;
  method: Method;
  paymentId: string | null;
  queued: boolean;
  remainingCents: number | null;
}

/** Renders `children` into the sheet's sticky footer (the sheet owns the slot). */
function Footer({
  slot,
  children,
}: {
  slot: HTMLElement | null;
  children: ReactNode;
}) {
  return slot ? createPortal(children, slot) : null;
}

export default function CollectSheet({
  jobId,
  invoiceId,
  allowDeposit,
  defaultTarget,
  onClose,
  footer,
}: {
  jobId?: string;
  invoiceId?: string;
  allowDeposit?: boolean;
  defaultTarget?: "deposit" | "balance";
  onClose: () => void;
  /** The sheet's footer slot: the main button renders there, never below the fold. */
  footer?: HTMLElement | null;
}) {
  const router = useRouter();
  const [ctx, setCtx] = useState<CollectContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-fetches
  useEffect(() => {
    let live = true;
    loadCollectContext({ jobId, invoiceId, allowDeposit }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setCtx(r.data);
      else setError(r.ok ? "Couldn't load this payment." : r.error);
    });
    return () => {
      live = false;
    };
  }, [jobId, invoiceId, allowDeposit, reload]);

  const close = (
    <Footer slot={footer ?? null}>
      <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
        Close
      </Button>
    </Footer>
  );
  if (error)
    return (
      <div className="py-2">
        <Banner tone="error" title="Can't collect here">
          {error}
        </Banner>
        {close}
      </div>
    );
  if (!ctx)
    return (
      <div className="flex flex-col gap-3 py-2" aria-busy>
        <Skeleton className="mx-auto h-20 w-48" rounded="card" />
        <Skeleton className="h-11 w-full" rounded="card" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
            <Skeleton key={i} className="h-[72px]" rounded="card" />
          ))}
        </div>
      </div>
    );
  return (
    <CollectForm
      key={reload}
      ctx={ctx}
      footer={footer ?? null}
      defaultTarget={defaultTarget}
      onClose={onClose}
      onMore={() => {
        setCtx(null);
        setReload((n) => n + 1);
        router.refresh();
      }}
    />
  );
}

function CollectForm({
  ctx,
  footer,
  defaultTarget,
  onClose,
  onMore,
}: {
  ctx: CollectContext;
  footer: HTMLElement | null;
  defaultTarget?: "deposit" | "balance";
  onClose: () => void;
  onMore: () => void;
}) {
  const router = useRouter();
  const targets: { value: Target; label: string }[] = [];
  if (ctx.invoiceId && ctx.balanceCents > 0)
    targets.push({ value: "balance", label: "Balance" });
  if (ctx.openDeposit) targets.push({ value: "deposit", label: "Deposit" });
  if (!ctx.invoiceId && !ctx.openDeposit && ctx.jobId)
    targets.push({ value: "prepay", label: "Prepayment" });
  const [target, setTarget] = useState<Target | null>(
    defaultTarget && targets.some((t) => t.value === defaultTarget)
      ? defaultTarget
      : ctx.openDeposit && !ctx.invoiceId
        ? "deposit"
        : (targets[0]?.value ?? null),
  );
  const due =
    target === "deposit"
      ? (ctx.openDeposit?.amountCents ?? 0)
      : target === "balance"
        ? ctx.balanceCents
        : null;
  const methods = useMemo(
    () =>
      (ctx.methods as Method[]).filter((m) =>
        m === "card" ? ctx.canCollectCard : ctx.canRecordManual && m !== "ach",
      ),
    [ctx],
  );
  const [method, setMethod] = useState<Method | null>(null);
  const [amount, setAmount] = useState<number | null>(due);
  const [editAmount, setEditAmount] = useState(false);
  const [tipPct, setTipPct] = useState<number | "custom">(0);
  const [customTip, setCustomTip] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [payer, setPayer] = useState("");
  const [proof, setProof] = useState<{
    clientId: string;
    mediaId?: string;
  } | null>(null);
  const [tendered, setTendered] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();
  const [fieldErr, setFieldErr] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setAmount(due);
    setEditAmount(false);
  }, [due]);

  const isPayment = target === "balance";
  const issuing = isPayment && ctx.issuesDraft;
  const tipsOn = ctx.tipsEnabled && isPayment;
  const tipCents =
    !tipsOn || amount == null
      ? 0
      : tipPct === "custom"
        ? (customTip ?? 0)
        : tipForPreset({
            amountCents: amount,
            feeLinesCents: ctx.feeLinesCents,
            pct: tipPct,
            tipOnFees: ctx.tipOnFees,
          });
  const over = due != null && amount != null && amount > due;
  const manual = !!method && method !== "card";
  const refRequired = manual && ctx.referenceRequired.includes(method);
  const photoRequired = method === "check" && ctx.requireCheckPhoto;
  const canSubmit =
    !!target &&
    manual &&
    amount != null &&
    amount > 0 &&
    !over &&
    (!refRequired || reference.trim().length > 0) &&
    (!photoRequired || !!proof);

  if (done)
    return (
      <DoneView
        ctx={ctx}
        done={done}
        footer={footer}
        onClose={onClose}
        onMore={onMore}
      />
    );

  if (targets.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-title3">Nothing to collect</p>
        <p className="text-subhead text-label-2">{nothingDueMessage(ctx)}</p>
        <Footer slot={footer}>
          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Close
          </Button>
        </Footer>
      </div>
    );

  const submitManual = () =>
    start(async () => {
      if (!method || method === "card" || amount == null || !target) return;
      setFieldErr({});
      const clientId = uuid();
      const input = {
        clientId,
        clientTs: new Date().toISOString(),
        jobId: ctx.jobId,
        invoiceId: target === "balance" ? ctx.invoiceId : null,
        depositRequestId:
          target === "deposit" ? (ctx.openDeposit?.id ?? null) : null,
        customerId: ctx.customerId,
        kind: target === "balance" ? "payment" : "deposit",
        method,
        amountCents: amount,
        tipCents,
        reference: reference.trim() || null,
        payerName: payer.trim() || null,
        proofMediaId: proof?.mediaId ?? null,
        proofClientId: proof && !proof.mediaId ? proof.clientId : null,
        // "Get paid" on a draft: the server issues it in the same transaction.
        issueDraft: issuing || undefined,
      };
      const r = await queueAction("payments.recordManual", input);
      if (r.queued) {
        setDone({
          amountCents: amount,
          tipCents,
          method,
          paymentId: null,
          queued: true,
          remainingCents: due != null ? due - amount : null,
        });
        return;
      }
      const res = r.result as
        | {
            ok: true;
            data?: { paymentId: string; balanceCents: number | null };
          }
        | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
        | undefined;
      if (!res || !res.ok) {
        const err = res && !res.ok ? res : null;
        setFieldErr(err?.fieldErrors ?? {});
        toast.error(err?.error ?? "Couldn't record the payment");
        return;
      }
      setDone({
        amountCents: amount,
        tipCents,
        method,
        paymentId: res.data?.paymentId ?? null,
        queued: false,
        remainingCents:
          target === "balance"
            ? (res.data?.balanceCents ?? (due != null ? due - amount : null))
            : null,
      });
      router.refresh();
    });

  const pickMethod = (m: Method) => {
    setMethod(m);
    setFieldErr({});
  };

  const tile = (m: Method) => (
    <button
      key={m}
      type="button"
      aria-pressed={method === m}
      onClick={() => pickMethod(m)}
      className={cx(
        "pressable flex min-h-[72px] flex-col items-start justify-center gap-2 rounded-card bg-card p-3 text-left text-headline shadow-card outline-offset-2",
        method === m && "ring-2 ring-inset ring-accent",
      )}
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-[12px] bg-fill-2 text-label"
      >
        {METHOD[m].icon}
      </span>
      {METHOD[m].label}
    </button>
  );
  const manualMethods = methods.filter((m) => m !== "card");
  const cardOffered = methods.includes("card");
  const first = ctx.customerFirstName ?? "the customer";

  return (
    <div className="flex flex-col gap-4 pb-4">
      <section
        aria-label="Amount"
        className="flex flex-col items-center gap-1 pt-1 text-center"
      >
        <p className="text-footnote text-label-2">
          {target === "deposit"
            ? `Deposit${ctx.jobNumber ? ` · ${ctx.jobNumber}` : ""}`
            : target === "prepay"
              ? `Prepayment${ctx.jobNumber ? ` · ${ctx.jobNumber}` : ""}`
              : `${ctx.invoiceNumber ?? "Invoice"} · balance ${formatMoney(ctx.balanceCents)}`}
        </p>
        <p className="num text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">
          {amount != null ? formatMoney(amount + tipCents) : "Any amount"}
        </p>
        <p className="text-footnote text-label-2" aria-live="polite">
          {tipCents > 0
            ? `Includes a ${formatMoney(tipCents)} tip`
            : due != null && amount != null && amount < due
              ? `Part of the ${formatMoney(due)} due`
              : (ctx.customerName ?? "")}
        </p>
        {ctx.depositPaid && target !== "deposit" ? (
          ctx.depositPaid.applied ? (
            <p className="text-footnote font-semibold text-success">
              Deposit {formatMoney(ctx.depositPaid.amountCents)} paid · already
              off the balance
            </p>
          ) : (
            <p className="text-footnote font-semibold text-warning">
              Deposit {formatMoney(ctx.depositPaid.amountCents)} paid, but not
              on this invoice · don&apos;t charge it twice
            </p>
          )
        ) : null}
        {due != null && !editAmount ? (
          <Button variant="plain" size="sm" onClick={() => setEditAmount(true)}>
            Change amount
          </Button>
        ) : null}
      </section>

      {editAmount || due == null ? (
        <MoneyField
          label={due == null ? "Amount" : "Amount (part of the balance)"}
          valueCents={amount}
          onChangeCents={setAmount}
          max={due ?? undefined}
          error={
            over
              ? `That's more than the ${formatMoney(due ?? 0)} due.`
              : fieldErr.amountCents
          }
        />
      ) : null}

      {targets.length > 1 && (
        <SegmentedControl<Target>
          label="What are you collecting?"
          value={target ?? undefined}
          onChange={(t) => {
            setTarget(t);
            setTipPct(0);
          }}
          segments={targets}
        />
      )}

      {issuing ? (
        <Banner tone="info">
          Getting paid issues {ctx.invoiceNumber}. It can&apos;t be edited
          after.
        </Banner>
      ) : null}
      {ctx.cardRestriction && (
        <Banner tone="warning" icon={<ShieldAlert size={20} />}>
          {ctx.cardRestriction}
        </Banner>
      )}
      {ctx.prepayRequired && target !== "prepay" && (
        <Banner tone="info">This customer is marked prepay-required.</Banner>
      )}

      {tipsOn && amount != null ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Tip</legend>
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${ctx.tipPresets.length + 1}, minmax(0, 1fr))`,
            }}
          >
            {[...ctx.tipPresets, "custom" as const].map((p) => {
              const on = tipPct === p;
              return (
                <button
                  key={String(p)}
                  type="button"
                  aria-pressed={on}
                  aria-label={
                    p === "custom"
                      ? "Custom tip"
                      : p === 0
                        ? "No tip"
                        : `${p}% tip, ${formatMoney(tipForPreset({ amountCents: amount, feeLinesCents: ctx.feeLinesCents, pct: p, tipOnFees: ctx.tipOnFees }))}`
                  }
                  onClick={() => setTipPct(p)}
                  className={cx(
                    "pressable flex min-h-11 items-center justify-center rounded-pill px-2 text-subhead font-semibold",
                    on ? "bg-label text-bg" : "bg-card text-label shadow-card",
                  )}
                >
                  {p === "custom" ? "Custom" : p === 0 ? "No tip" : `${p}%`}
                </button>
              );
            })}
          </div>
          {tipPct === "custom" && (
            <MoneyField
              label="Tip amount"
              valueCents={customTip}
              onChangeCents={setCustomTip}
            />
          )}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">How they pay</legend>
        {cardOffered ? (
          ctx.cardLinks ? (
            <button
              type="button"
              aria-pressed={method === "card"}
              onClick={() => pickMethod("card")}
              className={cx(
                "pressable flex min-h-[72px] items-center gap-3 rounded-card bg-label p-3 text-left text-bg shadow-card outline-offset-2",
                method === "card" && "ring-2 ring-inset ring-accent",
              )}
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-[12px]"
                style={{ background: "rgb(127 127 127 / 0.35)" }}
              >
                <QrCode size={20} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-headline">Pay on their phone</span>
                <span className="text-footnote opacity-70">
                  QR code · Apple Pay, Google Pay, card
                </span>
              </span>
            </button>
          ) : (
            <div
              aria-disabled="true"
              className="flex min-h-[72px] items-center gap-3 rounded-card bg-card p-3 shadow-card"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-fill-2 text-label-3"
              >
                <CreditCard size={20} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-headline text-label-3">Card</span>
                <span className="text-footnote text-label-2">
                  Needs a card processor (Settings → Integrations)
                </span>
              </span>
            </div>
          )
        ) : null}
        {manualMethods.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {manualMethods.map(tile)}
          </div>
        ) : null}
      </fieldset>

      {manual && method ? (
        <ManualFields
          ctx={ctx}
          method={method}
          first={first}
          due={due}
          amount={amount}
          tipCents={tipCents}
          reference={reference}
          setReference={setReference}
          payer={payer}
          setPayer={setPayer}
          proof={proof}
          setProof={setProof}
          tendered={tendered}
          setTendered={setTendered}
          refRequired={refRequired}
          photoRequired={photoRequired}
          fieldErr={fieldErr}
        />
      ) : null}

      {method === "card" ? (
        <CardPanel
          ctx={ctx}
          target={target}
          issuing={issuing}
          first={first}
          tipPct={typeof tipPct === "number" ? tipPct : 0}
        />
      ) : null}

      <Footer slot={footer}>
        {method === "card" ? (
          <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!canSubmit}
            onClick={submitManual}
          >
            {!method
              ? "Pick how they pay"
              : amount
                ? `Record ${formatMoney(amount + tipCents)} ${METHOD_PHRASE[method]}`
                : `Record ${METHOD[method].label} payment`}
          </Button>
        )}
      </Footer>
    </div>
  );
}

function ManualFields(p: {
  ctx: CollectContext;
  method: Method;
  first: string;
  due: number | null;
  amount: number | null;
  tipCents: number;
  reference: string;
  setReference: (v: string) => void;
  payer: string;
  setPayer: (v: string) => void;
  proof: { clientId: string; mediaId?: string } | null;
  setProof: (v: { clientId: string; mediaId?: string } | null) => void;
  tendered: number | null;
  setTendered: (v: number | null) => void;
  refRequired: boolean;
  photoRequired: boolean;
  fieldErr: Record<string, string[]>;
}) {
  const { ctx, method } = p;
  const total = (p.amount ?? 0) + p.tipCents;
  return (
    <div className="flex flex-col gap-3">
      {method === "cash" &&
      ctx.feePolicy === "cash_discount" &&
      ctx.cashDiscountBps > 0 &&
      p.due ? (
        <p className="px-1 text-footnote text-label-2">
          Cash price {formatMoney(cashPriceCents(p.due, ctx.cashDiscountBps))}
        </p>
      ) : null}
      {(method === "zelle" || method === "venmo") &&
      ctx.manualInstructions.trim() ? (
        <section
          aria-label="How to pay"
          className="rounded-card bg-card p-4 shadow-card"
        >
          <p className="text-footnote font-semibold text-label-2">
            Read this to {p.first}
          </p>
          <p className="mt-1 whitespace-pre-line text-body">
            {ctx.manualInstructions}
          </p>
          <p className="mt-1 text-subhead text-label-2">
            Amount {formatMoney(total)}
            {ctx.jobNumber ? ` · reference ${ctx.jobNumber}` : ""}
          </p>
        </section>
      ) : null}
      {method === "cash" ? (
        <MoneyField
          label="Cash received"
          hint={
            p.tendered != null && p.tendered > total
              ? `Change due ${formatMoney(p.tendered - total)}`
              : "Optional: work out the change"
          }
          valueCents={p.tendered}
          onChangeCents={p.setTendered}
        />
      ) : (
        <TextField
          label={
            method === "check"
              ? "Check number"
              : `${METHOD[method].label} confirmation #`
          }
          value={p.reference}
          onChange={(e) => p.setReference(e.currentTarget.value)}
          required={p.refRequired}
          error={p.fieldErr.reference}
          inputMode={method === "check" ? "numeric" : "text"}
          autoComplete="off"
        />
      )}
      {method === "check" || method === "zelle" || method === "venmo" ? (
        <TextField
          label="Paid by (name on the account)"
          value={p.payer}
          onChange={(e) => p.setPayer(e.currentTarget.value)}
          autoComplete="off"
        />
      ) : null}
      {method !== "cash" ? (
        <div className="flex flex-col gap-1.5">
          <p className="px-1 text-footnote text-label-2">
            {method === "check"
              ? `Photo of the check${p.photoRequired ? " (required)" : " (optional)"}`
              : "Screenshot of the confirmation (optional)"}
          </p>
          <CameraButton
            kind="photo"
            tag="document"
            jobId={ctx.jobId}
            multiple={false}
            showLibrary={method !== "check"}
            label={
              p.proof
                ? "Retake"
                : method === "check"
                  ? "Photograph check"
                  : "Add screenshot"
            }
            onQueued={(r) =>
              p.setProof({ clientId: r.clientId, mediaId: r.mediaId })
            }
            onUploaded={(r) =>
              p.setProof({ clientId: r.clientId, mediaId: r.mediaId })
            }
          />
          {p.fieldErr.proofMediaId && (
            <p className="px-1 text-footnote text-danger">
              {p.fieldErr.proofMediaId.join(" ")}
            </p>
          )}
          <p className="px-1 text-footnote text-label-2">
            Shows as Unverified until the office confirms it in the bank.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CardPanel({
  ctx,
  target,
  issuing,
  first,
  tipPct,
}: {
  ctx: CollectContext;
  target: Target | null;
  issuing: boolean;
  first: string;
  tipPct: number;
}) {
  const [pending, start] = useTransition();
  const [base, setBase] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<QueuedOutcome | null>(null);
  const [sent, setSent] = useState(false);
  const forDeposit = target === "deposit" && ctx.openDeposit;
  const canLink = forDeposit || (target === "balance" && ctx.invoiceId);
  // The tip picked here is the pay page's starting choice (they can change it).
  const url =
    base && !forDeposit && tipPct > 0 ? `${base}?tip=${tipPct}` : base;

  // Picking "Pay on their phone" shows the QR right away (a draft is issued first).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per target
  useEffect(() => {
    if (!canLink || base) return;
    start(async () => {
      const r = await createPayLink(
        forDeposit
          ? { depositRequestId: ctx.openDeposit?.id }
          : {
              invoiceId: ctx.invoiceId ?? undefined,
              issueDraft: issuing || undefined,
            },
      );
      if (r.ok && r.data) setBase(r.data.url);
      else if (!r.ok) toast.error(r.error);
    });
  }, [target]);

  if (!canLink)
    return (
      <Banner tone="info">
        Card payments need an invoice or a deposit to pay.
      </Banner>
    );

  const send = () =>
    start(async () => {
      if (forDeposit) {
        const r = await sendDepositLink({
          depositRequestId: ctx.openDeposit?.id as string,
        });
        if (r.ok) {
          setSent(true);
          toast.success("Deposit link sent");
        } else toast.error(r.error);
        return;
      }
      const r = await sendPayLink({
        invoiceId: ctx.invoiceId as string,
        channel: "customer_preferred",
        issueDraft: issuing || undefined,
        clientId: uuid(),
      });
      if (r.ok && r.data) {
        setBase((b) => b ?? r.data?.url ?? null);
        setOutcome(r.data.outcome);
      } else if (!r.ok) toast.error(r.error);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2 py-1">
        {url ? (
          <div
            className="w-64 rounded-card bg-white p-3"
            // Server-safe SVG string from our own encoder (no user HTML).
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from src/lib/qr
            dangerouslySetInnerHTML={{
              __html: qrSvg(url, { title: "Pay link QR code" }),
            }}
          />
        ) : (
          <Skeleton width={256} height={256} rounded="card" />
        )}
        <p className="text-center text-footnote text-label-2">
          {first.charAt(0).toUpperCase() + first.slice(1)} scans this with their
          phone camera and pays by Apple Pay, Google Pay or card
          {ctx.riskBand === "high" || ctx.riskBand === "critical"
            ? " (with 3-D Secure)"
            : ""}
          . You&apos;ll see the payment here once it clears.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="tinted"
          icon={<MessageSquare size={18} aria-hidden />}
          disabled={(!ctx.customerHasPhone && !ctx.customerHasEmail) || sent}
          loading={pending && !!base}
          onClick={send}
        >
          Text the link
        </Button>
        <Button
          variant="secondary"
          icon={<Copy size={18} aria-hidden />}
          disabled={!url}
          onClick={() => {
            if (!url) return;
            navigator.clipboard?.writeText(url).then(
              () => toast.success("Link copied"),
              () => toast.error("Couldn't copy"),
            );
          }}
        >
          Copy link
        </Button>
      </div>
      {url ? (
        <Button
          variant="plain"
          href={url}
          target="_blank"
          rel="noopener"
          icon={<ExternalLink size={18} aria-hidden />}
        >
          Open the pay page on this phone
        </Button>
      ) : null}
      {outcome ? (
        <SendResultView
          outcome={outcome}
          firstName={first}
          what="pay link"
          templateKey="invoice.pay_link"
          templateLabel="Pay link"
        />
      ) : null}
    </div>
  );
}

function DoneView({
  ctx,
  done,
  footer,
  onClose,
  onMore,
}: {
  ctx: CollectContext;
  done: Done;
  footer: HTMLElement | null;
  onClose: () => void;
  onMore: () => void;
}) {
  const remaining = done.remainingCents ?? 0;
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [auto, setAuto] = useState<ReceiptAutoSend[]>([]);
  const [viewing, setViewing] = useState(false);
  const paymentId = done.paymentId;

  // The receipt (the invoice's payments for the card) and, a moment later, whether
  // the automatic receipt went out (the payment_receipt automation runs right after
  // the response).
  useEffect(() => {
    if (!paymentId) return;
    let live = true;
    loadReceipt({ paymentId }).then((r) => {
      if (live && r.ok && r.data) setReceipt(r.data);
    });
    const timers = [1200, 4000].map((ms) =>
      window.setTimeout(() => {
        receiptStatus({ paymentId }).then((r) => {
          if (live && r.ok && r.data?.length) setAuto(r.data);
        });
      }, ms),
    );
    return () => {
      live = false;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [paymentId]);

  const emailed = auto.find(
    (a) => a.channel === "email" && a.status !== "pending_tap",
  );
  const texted = auto.find(
    (a) =>
      (a.channel === "sms" || a.channel === "whatsapp") &&
      a.status !== "pending_tap",
  );
  const paidInFull =
    !done.queued &&
    ctx.invoiceId != null &&
    done.remainingCents != null &&
    remaining <= 0;
  const methodLabel = receipt?.methodLabel ?? METHOD[done.method].label;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-col items-center gap-1 pt-4 text-center">
        {done.queued ? (
          <WifiOff aria-hidden size={48} className="text-warning" />
        ) : (
          <SuccessCheck size={72} label="Paid" />
        )}
        <p className="num mt-2 text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">
          {formatMoney(done.amountCents + done.tipCents)}
        </p>
        <p className="text-subhead text-label-2">
          {done.queued
            ? "Saved on this phone: it syncs when you're back online."
            : `Paid · ${methodLabel}${done.tipCents > 0 ? ` · tip ${formatMoney(done.tipCents)}` : ""}`}
        </p>
      </div>

      {receipt?.invoiceNumber ? (
        <section
          aria-label={`Invoice ${receipt.invoiceNumber}`}
          className="flex flex-col gap-2 rounded-card bg-card p-4 shadow-card"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="num text-subhead text-label-2">
              {receipt.invoiceNumber}
            </span>
            {paidInFull ? (
              <Pill tone="green" size="sm">
                Paid in full
              </Pill>
            ) : remaining > 0 ? (
              <Pill tone="orange" size="sm">
                {formatMoney(remaining)} still due
              </Pill>
            ) : null}
          </div>
          {receipt.invoicePayments.map((p) => (
            <div
              key={p.id}
              className="flex items-baseline justify-between gap-3 text-body"
            >
              <span className="min-w-0">
                {p.label} · {p.atLabel}
              </span>
              <span className="num shrink-0">{formatMoney(p.cents)}</span>
            </div>
          ))}
        </section>
      ) : !done.queued && remaining > 0 ? (
        <p className="text-center text-headline">
          {formatMoney(remaining)} still due
        </p>
      ) : null}

      {remaining > 0 && !done.queued ? (
        <Button size="lg" fullWidth onClick={onMore}>
          Collect the remaining {formatMoney(remaining)}
        </Button>
      ) : null}

      {paymentId && receipt ? (
        <ReceiptSend
          paymentId={paymentId}
          firstName={receipt.customerFirstName}
          hasPhone={receipt.customerHasPhone}
          hasEmail={receipt.customerHasEmail}
        />
      ) : null}
      {emailed || texted ? (
        <p className="px-1 text-footnote text-label-2" aria-live="polite">
          {[
            emailed
              ? `Receipt emailed${emailed.to ? ` to ${emailed.to}` : ""}`
              : null,
            texted ? `texted${texted.to ? ` to ${texted.to}` : ""}` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      ) : null}
      {paymentId ? (
        <Button variant="plain" onClick={() => setViewing(true)}>
          View receipt
        </Button>
      ) : null}
      {paymentId && viewing ? (
        <ReceiptSheet
          open={viewing}
          onOpenChange={setViewing}
          paymentId={paymentId}
        />
      ) : null}

      <Footer slot={footer}>
        <Button
          variant={remaining > 0 && !done.queued ? "secondary" : "primary"}
          size="lg"
          fullWidth
          onClick={onClose}
        >
          Done
        </Button>
      </Footer>
    </div>
  );
}
