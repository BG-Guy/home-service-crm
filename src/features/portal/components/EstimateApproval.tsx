"use client";

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { optionTotals } from "@/features/estimates/logic";
import type { DocLineType } from "@/features/invoices/math";
import { formatMoney } from "@/lib/money";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Pill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import { approveChangeOrderPublic, approveEstimatePublic } from "../actions";

// The customer's side of /e/[token] (SPEC M07/M23): choose an option (good /
// better / best cards), tick add-ons, see the total in the booking bar, then the
// ESIGN consent + typed name + drawn signature (S15, uploaded through the
// magic-link route) in a sheet that slides up. Decline with an optional reason.
// Both sheets are lazy chunks loaded on first intent (hover / touch / focus of
// their button), so the page's first load carries only the cards and the bar.

const loadSignature = () =>
  import("@/features/signatures/slots.client").then((m) => m.SignatureSheet);
const loadDecline = () => import("./DeclineEstimateSheet");
const SignatureSheet = dynamic(loadSignature, { ssr: false });
const DeclineEstimateSheet = dynamic(loadDecline, { ssr: false });

export interface PortalLine {
  id: string;
  type: DocLineType;
  name: string;
  description: string | null;
  qty: number;
  totalCents: number;
  taxable: boolean;
  isOptional: boolean;
  isSelected: boolean;
  isServiceFee: boolean;
}

export interface PortalOption {
  id: string;
  label: string;
  recommended: boolean;
  notes: string | null;
  lines: PortalLine[];
  depositCents: number | null;
}

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function EstimateApproval({
  token,
  kind,
  number,
  options,
  taxBps,
  taxExempt,
  consentText,
  signerNameDefault,
  coolingOff,
  children,
}: {
  token: string;
  kind: "estimate" | "change_order";
  number: string;
  options: PortalOption[];
  taxBps: number;
  taxExempt: boolean;
  consentText: string;
  signerNameDefault: string;
  coolingOff: boolean;
  /** Page content after the options (warranty, terms, footer); the booking bar follows it. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [pickId, setPickId] = useState(
    options.find((o) => o.recommended)?.id ?? options[0]?.id ?? "",
  );
  const [addons, setAddons] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      options.map((o) => [
        o.id,
        o.lines.filter((l) => l.isOptional && l.isSelected).map((l) => l.id),
      ]),
    ),
  );
  const [signing, setSigning] = useState(false);
  const [declining, setDeclining] = useState(false);
  // Mount each lazy sheet on first open and keep it mounted (close animation).
  const [signMounted, setSignMounted] = useState(false);
  const [declineMounted, setDeclineMounted] = useState(false);
  const openSign = () => {
    setSignMounted(true);
    setSigning(true);
  };
  const openDecline = () => {
    setDeclineMounted(true);
    setDeclining(true);
  };
  const pick = options.find((o) => o.id === pickId);
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const o of options)
      out[o.id] = optionTotals(
        o.lines.map((l) => ({
          id: l.id,
          type: l.type,
          totalCents: l.totalCents,
          taxable: l.taxable,
          isOptional: l.isOptional,
          isSelected: l.isSelected,
        })),
        taxBps,
        { taxExempt, selectedAddonIds: addons[o.id] ?? [] },
      ).totalCents;
    return out;
  }, [options, addons, taxBps, taxExempt]);
  const total = pick ? (totals[pick.id] ?? 0) : 0;
  const toggle = (optionId: string, lineId: string, on: boolean) =>
    setAddons((a) => ({
      ...a,
      [optionId]: on
        ? [...(a[optionId] ?? []), lineId]
        : (a[optionId] ?? []).filter((x) => x !== lineId),
    }));

  const multi = options.length > 1;
  const canApprove = !!pick && pick.lines.length > 0;
  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 px-1 text-title3">
          {multi ? "Choose an option" : "Your estimate"}
        </legend>
        {options.map((o) => {
          const selected = o.id === pickId;
          const required = o.lines.filter((l) => !l.isOptional);
          const extras = o.lines.filter((l) => l.isOptional);
          return (
            <div
              key={o.id}
              className={cx(
                "relative rounded-card bg-card shadow-card transition-[box-shadow,transform] duration-[var(--dur-quick)] ease-[var(--ease-spring-snappy)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                multi && selected
                  ? "shadow-[var(--shadow-raised)] ring-2 ring-accent"
                  : "ring-0",
              )}
            >
              <label
                className={cx(
                  "block p-4 pb-3 sm:p-5 sm:pb-4",
                  multi && "cursor-pointer active:scale-[.99]",
                )}
              >
                <input
                  type="radio"
                  name="estimate-option"
                  value={o.id}
                  checked={selected}
                  onChange={() => setPickId(o.id)}
                  className="sr-only"
                />
                <div className="flex items-start gap-3">
                  {multi ? (
                    <span
                      aria-hidden
                      className={cx(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--dur-quick)]",
                        selected
                          ? "bg-accent text-white"
                          : "shadow-[inset_0_0_0_2px_var(--label-3)]",
                      )}
                    >
                      {selected ? <Check size={14} strokeWidth={3} /> : null}
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-headline">{o.label}</span>
                      {o.recommended && multi ? (
                        <Pill tone="accent" size="sm" dot={false}>
                          Recommended
                        </Pill>
                      ) : null}
                    </div>
                    {o.notes ? (
                      <p className="mt-0.5 text-subhead text-label-2">
                        {o.notes}
                      </p>
                    ) : null}
                  </div>
                  <span className="num shrink-0 text-title3">
                    {formatMoney(totals[o.id] ?? 0)}
                  </span>
                </div>
              </label>
              {/* Only the chosen option shows its lines (M15 disclosure) */}
              <div
                className="disclosure"
                data-open={selected || !multi || undefined}
              >
                <div inert={!(selected || !multi) || undefined}>
                  <div className="px-4 pb-4 sm:px-5">
                    <ul
                      className={cx(
                        "space-y-1.5 border-t border-sep pt-3 text-subhead",
                        multi && "sm:ml-9",
                      )}
                    >
                      {required.map((l) => (
                        <li key={l.id} className="flex justify-between gap-3">
                          <span className="min-w-0 text-label-2">
                            <span className="text-label">{l.name}</span>
                            {l.qty !== 1 ? (
                              <> × {qtyFmt.format(l.qty)}</>
                            ) : null}
                            {l.isServiceFee ? (
                              <span className="block text-footnote">
                                Credited if you approve the repair
                              </span>
                            ) : l.description ? (
                              <span className="block text-footnote">
                                {l.description}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={cx(
                              "num shrink-0",
                              l.type === "discount" && "text-success",
                            )}
                          >
                            {formatMoney(l.totalCents)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {extras.length > 0 ? (
                    <fieldset
                      className={cx(
                        "mx-4 border-t border-sep pb-2 pt-3 sm:mx-5",
                        multi && "sm:ml-14",
                      )}
                    >
                      <legend className="sr-only">Add-ons for {o.label}</legend>
                      <p className="pb-1 text-subhead font-semibold text-label-2">
                        Optional add-ons
                      </p>
                      {extras.map((l) => {
                        const on = (addons[o.id] ?? []).includes(l.id);
                        return (
                          <label
                            key={l.id}
                            className="flex min-h-11 cursor-pointer items-center gap-3"
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                setPickId(o.id);
                                toggle(o.id, l.id, e.currentTarget.checked);
                              }}
                              className="size-[22px] shrink-0 accent-[var(--accent)]"
                            />
                            <span className="min-w-0 flex-1 text-subhead">
                              {l.name}
                              {l.description ? (
                                <span className="block text-footnote text-label-2">
                                  {l.description}
                                </span>
                              ) : null}
                            </span>
                            <span className="num text-subhead">
                              +{formatMoney(l.totalCents)}
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>
                  ) : null}
                  {o.depositCents ? (
                    <p
                      className={cx(
                        "px-4 pb-4 text-footnote text-label-2 sm:px-5",
                        multi && "sm:pl-14",
                      )}
                    >
                      Deposit to book: {formatMoney(o.depositCents)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </fieldset>

      {coolingOff ? (
        <p className="rounded-card bg-[color-mix(in_srgb,var(--sys-indigo)_12%,transparent)] p-4 text-subhead">
          You may cancel this transaction, without any penalty or obligation,
          within three business days from the date you sign. The full notice is
          below.
        </p>
      ) : null}

      <div className="flex justify-center print:hidden">
        <Button
          variant="plain"
          size="sm"
          className="text-label-2"
          onPointerEnter={loadDecline}
          onFocus={loadDecline}
          onClick={openDecline}
        >
          Not right now? Decline
        </Button>
      </div>

      {children}

      <BottomBar
        edge
        label="Approve estimate"
        className="print:hidden md:bottom-4 md:mx-0 md:rounded-card md:shadow-[var(--shadow-float)]"
        summary={
          <BarSummary
            title={formatMoney(total)}
            subtitle={pick && multi ? `${pick.label} · total` : "Total"}
          />
        }
        action={
          <Button
            size="lg"
            disabled={!canApprove}
            onPointerEnter={loadSignature}
            onTouchStart={loadSignature}
            onFocus={loadSignature}
            onClick={openSign}
          >
            Approve
          </Button>
        }
      />

      {pick && signMounted ? (
        <SignatureSheet
          open={signing}
          onOpenChange={setSigning}
          title={`Approve ${number}`}
          docType={kind}
          consentText={consentText}
          publicToken={token}
          signerNameDefault={signerNameDefault}
          summaryLines={[
            `${pick.label}: ${formatMoney(total)}`,
            ...pick.lines
              .filter(
                (l) => l.isOptional && (addons[pick.id] ?? []).includes(l.id),
              )
              .map((l) => `Add-on: ${l.name}`),
            ...(pick.depositCents
              ? [`Deposit due next: ${formatMoney(pick.depositCents)}`]
              : []),
          ]}
          action={async (s) => {
            if (kind === "change_order")
              return approveChangeOrderPublic({ ...s, token });
            const r = await approveEstimatePublic({
              ...s,
              token,
              optionId: pick.id,
              addonIds: addons[pick.id] ?? [],
            });
            return r.ok
              ? { ok: true, data: { signatureId: r.data?.signatureId ?? "" } }
              : r;
          }}
          onSigned={() => {
            setSigning(false);
            router.refresh();
          }}
        />
      ) : null}
      {declineMounted ? (
        <DeclineEstimateSheet
          open={declining}
          onClose={() => setDeclining(false)}
          token={token}
          onDone={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
