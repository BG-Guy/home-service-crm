"use client";

import {
  Banknote,
  CircleCheck,
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
import { registerOfflineActions } from "@/client/offline-registry";
import { queueAction } from "@/client/outbox";
import { formatMoney } from "@/lib/money";
import { qrSvg } from "@/lib/qr";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { MoneyText } from "@/ui/components/MoneyText";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Skeleton } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import {
  createPayLink,
  loadCollectContext,
  sendDepositLink,
  sendPayLink,
  sendReceipt,
} from "../actions";
import type { CollectContext } from "../contracts";
import { cashPriceCents, tipForPreset } from "../engine/fees";
import { offlineActions } from "../offline";

// Self-register until the integrator spreads every module into offline-registry.ts
// (idempotent; the outbox resolves "payments.recordManual" through the registry).
registerOfflineActions(offlineActions);

// Collect-payment sheet body (S19/S20). Loaded lazily by slots.client.tsx so the
// method tiles, tip math and camera never ship in a route's first bundle.

type Method = "card" | "cash" | "check" | "zelle" | "venmo" | "ach" | "other";
type Target = "balance" | "deposit" | "prepay";

const METHOD: Record<Method, { label: string; icon: ReactNode }> = {
  card: { label: "Card", icon: <CreditCard size={22} /> },
  cash: { label: "Cash", icon: <Banknote size={22} /> },
  check: { label: "Check", icon: <FileCheck2 size={22} /> },
  zelle: { label: "Zelle", icon: <Smartphone size={22} /> },
  venmo: { label: "Venmo", icon: <Smartphone size={22} /> },
  ach: { label: "Bank", icon: <Landmark size={22} /> },
  other: { label: "Other", icon: <CircleEllipsis size={22} /> },
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

export default function CollectSheet({
  jobId,
  invoiceId,
  allowDeposit,
  defaultTarget,
  onClose,
}: {
  jobId?: string;
  invoiceId?: string;
  allowDeposit?: boolean;
  defaultTarget?: "deposit" | "balance";
  onClose: () => void;
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

  if (error)
    return (
      <div className="p-4">
        <Banner tone="error" title="Can't collect here">
          {error}
        </Banner>
      </div>
    );
  if (!ctx)
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy>
        <Skeleton className="h-20 w-full" rounded="card" />
        <Skeleton className="h-11 w-full" rounded="card" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }, (_, i) => (
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
  defaultTarget,
  onClose,
  onMore,
}: {
  ctx: CollectContext;
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
  }, [due]);

  const isPayment = target === "balance";
  const tipsOn = ctx.tipsEnabled && isPayment && method !== null;
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
  const refRequired =
    !!method && method !== "card" && ctx.referenceRequired.includes(method);
  const photoRequired = method === "check" && ctx.requireCheckPhoto;
  const canSubmit =
    !!target &&
    !!method &&
    method !== "card" &&
    amount != null &&
    amount > 0 &&
    !over &&
    (!refRequired || reference.trim().length > 0) &&
    (!photoRequired || !!proof);

  if (done)
    return <DoneView ctx={ctx} done={done} onClose={onClose} onMore={onMore} />;

  if (targets.length === 0)
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CircleCheck aria-hidden size={44} className="text-success" />
          <p className="text-title3 font-semibold">Nothing due</p>
          <p className="text-subhead text-label-2">
            {ctx.invoiceNumber
              ? `Invoice ${ctx.invoiceNumber} is paid in full.`
              : "There's no invoice or deposit to collect yet."}
          </p>
        </div>
        <Button variant="gray" onClick={onClose}>
          Close
        </Button>
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
        toast({
          title: "Saved offline",
          message: "It syncs automatically when you're back online.",
          tone: "warning",
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
      toast.success(`${formatMoney(amount + tipCents)} recorded`);
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

  const tile = (m: Method) => {
    const disabled = m === "card" && !ctx.cardLinks;
    return (
      <button
        key={m}
        type="button"
        aria-pressed={method === m}
        disabled={disabled}
        onClick={() => setMethod(m)}
        className={cx(
          "pressable flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-card border text-subhead font-semibold outline-offset-2 transition-[background-color,border-color] duration-200",
          method === m
            ? "border-accent bg-accent/12 text-accent-text"
            : "border-transparent bg-fill-2 text-label",
          disabled && "opacity-40",
        )}
      >
        {METHOD[m].icon}
        {METHOD[m].label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      <section
        aria-label="Amount due"
        className="flex flex-col gap-1 rounded-card bg-card-2 p-4 text-center"
      >
        <p className="text-subhead font-semibold text-label-2">
          {target === "deposit"
            ? "Deposit due"
            : target === "prepay"
              ? "Prepayment"
              : `Balance due${ctx.invoiceNumber ? ` · ${ctx.invoiceNumber}` : ""}`}
        </p>
        <p className="num text-large-title font-bold">
          {due != null ? <MoneyText cents={due} /> : "Any amount"}
        </p>
        {ctx.customerName && (
          <p className="text-subhead text-label-2">{ctx.customerName}</p>
        )}
        {ctx.depositPaid && (
          <p className="text-footnote font-semibold text-success">
            Deposit {formatMoney(ctx.depositPaid.amountCents)} paid
            {ctx.depositPaid.at
              ? ` ${new Date(ctx.depositPaid.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : ""}{" "}
            · already applied, don't charge it again
          </p>
        )}
      </section>

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

      {ctx.cardRestriction && (
        <Banner tone="warning" icon={<ShieldAlert size={20} />}>
          {ctx.cardRestriction}
        </Banner>
      )}
      {ctx.prepayRequired && target !== "prepay" && (
        <Banner tone="info">This customer is marked prepay-required.</Banner>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="px-1 pb-2 text-subhead font-semibold text-label-2">
          Method
        </legend>
        <div className="grid grid-cols-3 gap-2">{methods.map(tile)}</div>
        {methods.includes("card") && !ctx.cardLinks && (
          <p className="px-1 text-footnote text-label-2">
            Card payments need a card processor (Settings → Integrations).
          </p>
        )}
      </fieldset>

      {method && method !== "card" && (
        <>
          <MoneyField
            label="Amount"
            valueCents={amount}
            onChangeCents={setAmount}
            max={due ?? undefined}
            error={
              over
                ? `That's more than the ${formatMoney(due ?? 0)} due.`
                : fieldErr.amountCents
            }
            hint={
              method === "cash" &&
              ctx.feePolicy === "cash_discount" &&
              ctx.cashDiscountBps > 0 &&
              due
                ? `Cash price ${formatMoney(cashPriceCents(due, ctx.cashDiscountBps))}`
                : undefined
            }
          />
          {tipsOn && (
            <fieldset className="flex flex-col gap-2">
              <legend className="px-1 pb-2 text-subhead font-semibold text-label-2">
                Tip
              </legend>
              <div className="flex flex-wrap gap-2">
                {[...ctx.tipPresets, "custom" as const].map((p) => {
                  const on = tipPct === p;
                  const cents =
                    p === "custom" || amount == null
                      ? null
                      : tipForPreset({
                          amountCents: amount,
                          feeLinesCents: ctx.feeLinesCents,
                          pct: p,
                          tipOnFees: ctx.tipOnFees,
                        });
                  return (
                    <button
                      key={String(p)}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTipPct(p)}
                      className={cx(
                        "pressable flex min-h-11 min-w-[64px] flex-col items-center justify-center rounded-[10px] px-3 text-subhead font-semibold",
                        on
                          ? "bg-accent-fill text-on-accent"
                          : "bg-fill-2 text-label",
                      )}
                    >
                      {p === "custom" ? "Custom" : p === 0 ? "No tip" : `${p}%`}
                      {cents != null && p !== 0 && (
                        <span className="num text-caption opacity-80">
                          {formatMoney(cents)}
                        </span>
                      )}
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
          )}
          {method === "cash" && (
            <MoneyField
              label="Cash received"
              hint={
                tendered != null &&
                amount != null &&
                tendered > amount + tipCents
                  ? `Change due ${formatMoney(tendered - amount - tipCents)}`
                  : "Optional: work out the change"
              }
              valueCents={tendered}
              onChangeCents={setTendered}
            />
          )}
          {method !== "cash" && (
            <TextField
              label={
                method === "check"
                  ? "Check number"
                  : `${METHOD[method].label} confirmation #`
              }
              value={reference}
              onChange={(e) => setReference(e.currentTarget.value)}
              required={refRequired}
              error={fieldErr.reference}
              inputMode={method === "check" ? "numeric" : "text"}
              autoComplete="off"
            />
          )}
          {(method === "check" || method === "zelle" || method === "venmo") && (
            <TextField
              label="Paid by (name on the account)"
              value={payer}
              onChange={(e) => setPayer(e.currentTarget.value)}
              autoComplete="off"
            />
          )}
          {method !== "cash" && (
            <div className="flex flex-col gap-1.5">
              <p className="px-1 text-footnote text-label-2">
                {method === "check"
                  ? `Photo of the check${photoRequired ? " (required)" : " (optional)"}`
                  : "Screenshot of the confirmation (optional)"}
              </p>
              <CameraButton
                kind="photo"
                tag="document"
                jobId={ctx.jobId}
                multiple={false}
                showLibrary={method !== "check"}
                label={
                  proof
                    ? "Retake"
                    : method === "check"
                      ? "Photograph check"
                      : "Add screenshot"
                }
                onQueued={(r) =>
                  setProof({ clientId: r.clientId, mediaId: r.mediaId })
                }
                onUploaded={(r) =>
                  setProof({ clientId: r.clientId, mediaId: r.mediaId })
                }
              />
              {fieldErr.proofMediaId && (
                <p className="px-1 text-footnote text-danger">
                  {fieldErr.proofMediaId.join(" ")}
                </p>
              )}
            </div>
          )}
          {method !== "cash" && (
            <p className="px-1 text-footnote text-label-2">
              Shows as Unverified until the office confirms it in the bank.
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={!canSubmit}
            onClick={submitManual}
          >
            {amount
              ? `Record ${formatMoney(amount + tipCents)} ${METHOD_PHRASE[method]}`
              : `Record ${METHOD[method].label} payment`}
          </Button>
        </>
      )}

      {method === "card" && <CardPanel ctx={ctx} target={target} />}
    </div>
  );
}

function CardPanel({
  ctx,
  target,
}: {
  ctx: CollectContext;
  target: Target | null;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const forDeposit = target === "deposit" && ctx.openDeposit;
  const canLink = forDeposit || (target === "balance" && ctx.invoiceId);

  if (!canLink)
    return (
      <Banner tone="info">
        Issue the invoice first, then send a card pay link.
      </Banner>
    );

  const mint = (mode: "open" | "qr") =>
    start(async () => {
      if (mode === "qr" && url) {
        setShowQr(true);
        return;
      }
      const r = await createPayLink(
        forDeposit
          ? { depositRequestId: ctx.openDeposit?.id }
          : { invoiceId: ctx.invoiceId ?? undefined },
      );
      if (r.ok && r.data) {
        setUrl(r.data.url);
        if (mode === "qr") setShowQr(true);
        else window.open(r.data.url, "_blank", "noopener");
      } else if (!r.ok) toast.error(r.error);
    });

  const send = (channel: "sms" | "email" | "customer_preferred") =>
    start(async () => {
      const r = forDeposit
        ? await sendDepositLink({
            depositRequestId: ctx.openDeposit?.id as string,
          })
        : await sendPayLink({ invoiceId: ctx.invoiceId as string, channel });
      if (r.ok) {
        setUrl(r.data?.url ?? null);
        toast.success(
          "status" in (r.data ?? {}) &&
            (r.data as { status?: string }).status === "pending_tap"
            ? "Link ready in your Outbox to send"
            : "Pay link sent",
        );
      } else toast.error(r.error);
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-subhead text-label-2">
        The customer pays on a secure card page
        {ctx.riskBand === "high" || ctx.riskBand === "critical"
          ? " with 3-D Secure verification"
          : ""}
        . You'll see the payment here as soon as it clears.
      </p>
      <Button
        size="lg"
        fullWidth
        icon={<ExternalLink size={20} />}
        loading={pending}
        onClick={() => mint("open")}
      >
        Customer pays on this phone
      </Button>
      {showQr && url ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <div
            className="w-56 rounded-card bg-white p-2"
            // Server-safe SVG string from our own encoder (no user HTML).
            // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from src/lib/qr
            dangerouslySetInnerHTML={{
              __html: qrSvg(url, { title: "Pay link QR code" }),
            }}
          />
          <p className="text-footnote text-label-2">
            The customer scans this with their phone camera.
          </p>
        </div>
      ) : (
        <Button
          variant="gray"
          fullWidth
          icon={<QrCode size={18} />}
          loading={pending}
          onClick={() => mint("qr")}
        >
          Show QR code
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="gray"
          icon={<MessageSquare size={18} />}
          disabled={!ctx.customerHasPhone && !ctx.customerHasEmail}
          loading={pending}
          onClick={() => send("customer_preferred")}
        >
          Send link
        </Button>
        <Button
          variant="gray"
          icon={<Copy size={18} />}
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
    </div>
  );
}

function DoneView({
  ctx,
  done,
  onClose,
  onMore,
}: {
  ctx: CollectContext;
  done: Done;
  onClose: () => void;
  onMore: () => void;
}) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const remaining = done.remainingCents ?? 0;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        {done.queued ? (
          <WifiOff aria-hidden size={48} className="text-warning" />
        ) : (
          <CircleCheck
            aria-hidden
            size={52}
            className="enter-pop text-success"
          />
        )}
        <p className="text-title2 font-bold">
          {formatMoney(done.amountCents + done.tipCents)}{" "}
          {METHOD_PHRASE[done.method]}
        </p>
        <p className="text-subhead text-label-2">
          {done.queued
            ? "Saved on this phone: it syncs when you're back online."
            : done.tipCents > 0
              ? `Includes a ${formatMoney(done.tipCents)} tip. Thank you!`
              : "Payment recorded."}
        </p>
        {remaining > 0 && (
          <p className="text-headline">{formatMoney(remaining)} still due</p>
        )}
      </div>
      {remaining > 0 && !done.queued && (
        <Button size="lg" fullWidth onClick={onMore}>
          Collect the remaining {formatMoney(remaining)}
        </Button>
      )}
      {done.paymentId && (ctx.customerHasPhone || ctx.customerHasEmail) && (
        <Button
          variant={remaining > 0 ? "gray" : "filled"}
          size="lg"
          fullWidth
          loading={pending}
          disabled={sent}
          icon={<MessageSquare size={18} />}
          onClick={() =>
            start(async () => {
              const r = await sendReceipt({
                paymentId: done.paymentId as string,
              });
              if (r.ok) {
                setSent(true);
                toast.success(
                  r.data?.status === "pending_tap"
                    ? "Receipt ready in your Outbox"
                    : "Receipt sent",
                );
              } else toast.error(r.error);
            })
          }
        >
          {sent ? "Receipt sent" : "Send receipt"}
        </Button>
      )}
      <Button variant="gray" size="lg" fullWidth onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
