import { CircleCheck, Clock, LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { hasCardProcessor } from "@/adapters/payments";
import { PayForm } from "@/features/payments/components/PayForm";
import { loadPayTarget } from "@/features/payments/pay-page";
import { requestMeta } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";
import { resolvePublicToken } from "@/lib/tokens";
import { Banner } from "@/ui/components/Banner";
import { EmptyState } from "@/ui/components/EmptyState";
import { MoneyText } from "@/ui/components/MoneyText";
import { cx } from "@/ui/cx";

export const metadata: Metadata = {
  title: "Payment",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

// Public pay page /p/[token] (SPEC M09, M23): invoice balance or a deposit. With a card
// processor: tip + hosted Checkout (3DS on High/Critical jobs). Without: manual pay
// instructions. Handles ?status=success|cancel after the hosted page.
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const status = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const meta = await requestMeta();
  const tok = await resolvePublicToken("pay", token, {
    path: "/p/[token]",
    action: status === "success" ? "paid" : status ? "viewed" : "pay_opened",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const company = await findCompany();
  if (!tok)
    return (
      <div className="list-card mt-4">
        <EmptyState
          icon={<LinkIcon size={44} strokeWidth={1.6} />}
          title="This link has expired"
          message={
            company?.phone
              ? `Call us at ${formatPhoneDisplay(company.phone)} and we'll send a fresh one.`
              : "Contact us and we'll send a fresh one."
          }
        />
      </div>
    );
  const t = await loadPayTarget(tok);
  if (!t)
    return (
      <div className="list-card mt-4">
        <EmptyState title="Nothing to pay here" />
      </div>
    );
  const s = await getSettings();
  const processor = hasCardProcessor();

  if (status === "success" || t.state === "paid")
    return (
      <div className="mt-4 flex flex-col items-center gap-3 rounded-card bg-card px-6 py-10 text-center">
        {t.state === "paid" ? (
          <CircleCheck
            aria-hidden
            size={56}
            className="enter-pop text-success"
          />
        ) : (
          <Clock aria-hidden size={52} className="text-accent-text" />
        )}
        <h1 className="text-title2 font-bold">
          {t.state === "paid" ? "Thank you!" : "Payment processing"}
        </h1>
        <p className="text-body text-label-2">
          {t.state === "paid"
            ? `${t.title} is paid${t.kind === "deposit" ? ". It will be applied to your final invoice." : " in full."}`
            : "We'll text or email your receipt as soon as it clears. You can close this page."}
        </p>
        <p className="text-footnote text-label-2">
          Questions about this charge? Reply to our message or call us
          {company?.phone ? ` at ${formatPhoneDisplay(company.phone)}` : ""}.
        </p>
      </div>
    );

  if (t.state === "closed")
    return (
      <div className="list-card mt-4">
        <EmptyState
          title="This payment is no longer open"
          message="Contact us if you think that's a mistake."
        />
      </div>
    );

  const allowTip = t.kind === "invoice" && s.payments.tips_enabled;
  return (
    <div className="flex flex-col gap-5">
      {status === "cancel" && (
        <Banner tone="warning">
          Payment canceled. Nothing was charged. You can try again below.
        </Banner>
      )}
      <section className="flex flex-col items-center gap-1 rounded-card bg-card px-5 py-6 text-center">
        <p className="text-footnote uppercase text-label-2">
          {t.title}
          {t.jobNumber && t.kind === "invoice" ? ` · job ${t.jobNumber}` : ""}
        </p>
        <h1 className="num text-large-title font-bold">
          <MoneyText cents={t.dueCents} />
        </h1>
        <p className="text-subhead text-label-2">
          {t.kind === "deposit"
            ? "Deposit due"
            : t.totals?.some((r) => r.kind === "balance")
              ? "Balance due"
              : "Amount due"}
        </p>
      </section>

      {t.kind === "invoice" && (t.lines.length > 0 || t.totals) && (
        <section aria-label="Items" className="list-card">
          {t.lines.slice(0, 12).map((l, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static lines
              key={i}
              className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2"
            >
              <span className="min-w-0 truncate text-body">
                {l.name}
                {l.qty !== 1 ? ` × ${l.qty}` : ""}
              </span>
              <MoneyText cents={l.totalCents} className="text-label-2" />
            </div>
          ))}
          {t.lines.length > 12 && (
            <p className="list-row px-4 py-2 text-footnote text-label-2">
              {t.lines.length - 12} more on the invoice
            </p>
          )}
          {/* The invoice's own totals rows (shared with the invoice document), so
              subtotal, tax, total, payments and credits foot to the balance. */}
          {(t.totals ?? []).map((r, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static order
              key={i}
              className={cx(
                "list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2",
                r.kind === "total" ? "font-semibold" : "text-subhead",
                r.muted && "text-label-2",
              )}
            >
              <span className="min-w-0">{r.label}</span>
              <MoneyText cents={r.cents} className="shrink-0" />
            </div>
          ))}
          {t.totals?.some((r) => r.kind === "balance") && (
            <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2 font-semibold">
              <span>Balance due</span>
              <MoneyText cents={t.dueCents} className="shrink-0" />
            </div>
          )}
        </section>
      )}

      {t.kind === "deposit" && t.policy && (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-4 text-footnote uppercase text-label-2">
            {t.policy.title}
          </h2>
          <p className="whitespace-pre-line rounded-card bg-card p-4 text-subhead text-label-2">
            {t.policy.body}
          </p>
          <p className="px-4 text-footnote text-label-2">
            By paying you agree to this policy (version {t.policy.version}).
          </p>
        </section>
      )}

      {processor ? (
        <PayForm
          token={token}
          dueCents={t.dueCents}
          feeLinesCents={t.feeLinesCents}
          tipPresets={s.payments.tip_presets_pct}
          tipOnFees={s.payments.tip_on_fees}
          allowTip={allowTip}
        />
      ) : (
        <section className="flex flex-col gap-2 rounded-card bg-card p-4">
          <h2 className="text-headline">How to pay</h2>
          <p className="whitespace-pre-line text-body">
            {s.payments.manual_instructions}
          </p>
          <p className="text-subhead text-label-2">
            Amount:{" "}
            <strong className="text-label">{formatMoney(t.dueCents)}</strong>
            {" · "}Reference:{" "}
            <strong className="text-label">{t.jobNumber ?? t.title}</strong>
          </p>
        </section>
      )}
      <p className="px-4 text-center text-footnote text-label-2">
        Questions about this charge? Reply to our message
        {company?.phone ? ` or call ${formatPhoneDisplay(company.phone)}` : ""}.
      </p>
    </div>
  );
}
