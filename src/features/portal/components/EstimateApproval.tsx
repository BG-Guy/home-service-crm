"use client";

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { optionTotals } from "@/features/estimates/logic";
import type { DocLineType } from "@/features/invoices/math";
import { formatMoney } from "@/lib/money";
import { BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { approveChangeOrderPublic, approveEstimatePublic } from "../actions";

// The customer's side of /e/[token] (SPEC M07/M23, Quote to Paid E4): one option
// per screen in a horizontal swipe (CSS scroll-snap, the recommended option first
// in view, page dots), each card with its photo, name, price, notes, what's
// included and its add-on toggles; a sticky "Choose Better · $450.73" goes
// straight to the one-step landscape signature (consent, name, pad, "Approve").
// The signature screen and the decline sheet are lazy chunks loaded on first
// intent, so the page's first load carries only the cards and the bar.

const loadApproval = () => import("@/features/signatures/approval.client");
const loadDecline = () => import("./DeclineEstimateSheet");
const SignatureApproval = dynamic(loadApproval, { ssr: false });
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

/** The first estimate photo, on top of every option card. */
export interface PortalPhoto {
  url: string;
  label: string;
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
  present,
  preview,
  photo,
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
  /** Present mode (staff tablet): the approval records an in-person signature. */
  present?: boolean;
  /** Preview as the customer: Choose and Decline are off, nothing is recorded. */
  preview?: boolean;
  photo?: PortalPhoto | null;
  /** Page content after the options (warranty, terms, footer); the booking bar follows it. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const recIndex = Math.max(
    0,
    options.findIndex((o) => o.recommended),
  );
  const [index, setIndex] = useState(recIndex);
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
  // Mount each lazy piece on first open and keep it mounted (close animation).
  const [signMounted, setSignMounted] = useState(false);
  const [declineMounted, setDeclineMounted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const multi = options.length > 1;
  const pick = options[index] ?? options[0];
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

  // The recommended option first in view (no animation on load).
  useLayoutEffect(() => {
    const el = scroller.current;
    const card = el?.children[recIndex] as HTMLElement | undefined;
    if (el && card)
      el.scrollLeft = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
  }, [recIndex]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let dist = Number.POSITIVE_INFINITY;
    [...el.children].forEach((c, i) => {
      const h = c as HTMLElement;
      const d = Math.abs(h.offsetLeft + h.offsetWidth / 2 - mid);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best !== index) setIndex(best);
  };
  const go = (i: number) => {
    const el = scroller.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2,
      behavior: "smooth",
    });
    setIndex(i);
  };

  const canApprove = !!pick && pick.lines.length > 0 && !preview;
  const others = options.filter((o) => o.id !== pick?.id).map((o) => o.label);
  const chooseLabel =
    kind === "change_order" || !multi
      ? `Approve · ${formatMoney(total)}`
      : `Choose ${pick?.label} · ${formatMoney(total)}`;
  const openSign = () => {
    setSignMounted(true);
    setSigning(true);
  };

  return (
    <>
      <section
        aria-label={multi ? "Choose an option" : "Your estimate"}
        aria-roledescription={multi ? "carousel" : undefined}
      >
        <div
          ref={scroller}
          onScroll={multi ? onScroll : undefined}
          className={cx(
            multi &&
              "-mx-[var(--gutter)] flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-[var(--gutter)] [scrollbar-width:none]",
            "pt-4 pb-3",
          )}
        >
          {options.map((o, i) => (
            <OptionCard
              key={o.id}
              option={o}
              index={i}
              count={options.length}
              active={i === index}
              multi={multi}
              total={totals[o.id] ?? 0}
              photo={photo}
              chosen={addons[o.id] ?? []}
              onToggle={(lineId, on) => toggle(o.id, lineId, on)}
            />
          ))}
        </div>
        {multi ? (
          <div className="flex flex-col items-center gap-1.5 print:hidden">
            <div className="flex items-center gap-1">
              {options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  aria-label={`Show ${o.label}`}
                  aria-current={i === index ? "true" : undefined}
                  onClick={() => go(i)}
                  className="hit-44 flex h-4 items-center justify-center px-1"
                >
                  <span
                    aria-hidden
                    className={cx(
                      "block h-2 rounded-pill transition-[width,background-color] duration-[var(--dur-quick)]",
                      i === index ? "w-6 bg-label" : "w-2 bg-label-3",
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-footnote text-label-2">
              Swipe for {others.join(" and ")}
            </p>
          </div>
        ) : null}
      </section>

      {coolingOff ? (
        <p className="mt-4 rounded-card bg-[color-mix(in_srgb,var(--sys-indigo)_12%,transparent)] p-4 text-subhead">
          You may cancel this transaction, without any penalty or obligation,
          within three business days from the date you sign. The full notice is
          below.
        </p>
      ) : null}

      <div className="mt-3 flex justify-center print:hidden">
        <Button
          variant="plain"
          size="sm"
          className="text-label-2"
          disabled={preview}
          onPointerEnter={loadDecline}
          onFocus={loadDecline}
          onClick={() => {
            setDeclineMounted(true);
            setDeclining(true);
          }}
        >
          Not right now? Decline
        </Button>
      </div>

      {children}

      <BottomBar
        edge
        label={kind === "change_order" ? "Approve change" : "Approve estimate"}
        className="print:hidden md:bottom-4 md:mx-0 md:rounded-card md:shadow-[var(--shadow-float)]"
        summary={
          <Button
            size="lg"
            block
            disabled={!canApprove}
            onPointerEnter={loadApproval}
            onTouchStart={loadApproval}
            onFocus={loadApproval}
            onClick={openSign}
          >
            {preview ? "Approve is off in preview" : chooseLabel}
          </Button>
        }
      />

      {pick && signMounted ? (
        <SignatureApproval
          open={signing}
          onOpenChange={setSigning}
          title={
            kind === "change_order"
              ? `Sign to approve ${number}`
              : multi
                ? `Sign to approve ${pick.label}`
                : `Sign to approve ${number}`
          }
          totalLabel={formatMoney(total)}
          docType={kind}
          consentText={consentText}
          publicToken={token}
          signerNameDefault={signerNameDefault}
          summary={
            <ApprovalSummary
              option={pick}
              multi={multi}
              total={total}
              addonIds={addons[pick.id] ?? []}
            />
          }
          action={async (s) => {
            if (kind === "change_order")
              return approveChangeOrderPublic({ ...s, token });
            const r = await approveEstimatePublic({
              ...s,
              token,
              optionId: pick.id,
              addonIds: addons[pick.id] ?? [],
              present,
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

/** One option on its own screen: photo, name, price, notes, included, add-ons. */
function OptionCard({
  option: o,
  index,
  count,
  active,
  multi,
  total,
  photo,
  chosen,
  onToggle,
}: {
  option: PortalOption;
  index: number;
  count: number;
  active: boolean;
  multi: boolean;
  total: number;
  photo?: PortalPhoto | null;
  chosen: string[];
  onToggle: (lineId: string, on: boolean) => void;
}) {
  const required = o.lines.filter((l) => !l.isOptional);
  const extras = o.lines.filter((l) => l.isOptional);
  return (
    <article
      aria-label={`${o.label}, option ${index + 1} of ${count}`}
      aria-roledescription={multi ? "slide" : undefined}
      className={cx(
        "relative flex flex-col rounded-[24px] bg-card p-4 shadow-card transition-shadow duration-[var(--dur-quick)] sm:p-5",
        multi && "w-[86%] max-w-[440px] shrink-0 snap-center",
        multi && active && "shadow-[var(--shadow-raised)] ring-2 ring-accent",
      )}
    >
      {o.recommended && multi ? (
        <span className="absolute -top-3 right-5 rounded-pill bg-accent-fill px-3 py-1 text-footnote font-semibold text-on-accent shadow-card">
          Recommended
        </span>
      ) : null}
      {photo ? (
        <figure className="relative m-0 mb-3 overflow-hidden rounded-[16px] bg-fill-2">
          {/* biome-ignore lint/performance/noImgElement: signed storage URL */}
          <img
            src={photo.url}
            alt={photo.label}
            loading={index === 0 ? "eager" : "lazy"}
            className="aspect-[2/1] w-full object-cover"
          />
          <figcaption className="absolute bottom-2 left-2 rounded-pill bg-black/60 px-2.5 py-0.5 text-footnote font-semibold text-white">
            {photo.label}
          </figcaption>
        </figure>
      ) : null}
      <h3 className="text-title3">{o.label}</h3>
      <p className="num mt-0.5 text-large-title font-bold">
        {formatMoney(total)}
      </p>
      {o.notes ? (
        <p className="mt-1 text-subhead text-label-2">{o.notes}</p>
      ) : null}
      <ul className="mt-3 space-y-2 text-body">
        {required.map((l) => (
          <li key={l.id} className="flex items-start gap-2.5">
            <Check
              aria-hidden
              size={18}
              strokeWidth={2.6}
              className="mt-0.5 shrink-0 text-success"
            />
            <span className="min-w-0 flex-1">
              {l.name}
              {l.qty !== 1 ? <> × {qtyFmt.format(l.qty)}</> : null}
              {l.isServiceFee ? (
                <span className="block text-footnote text-label-2">
                  Credited if you approve the repair
                </span>
              ) : l.description ? (
                <span className="block text-footnote text-label-2">
                  {l.description}
                </span>
              ) : null}
            </span>
            <span
              className={cx(
                "num shrink-0 text-subhead",
                l.type === "discount" ? "text-success" : "text-label-2",
              )}
            >
              {formatMoney(l.totalCents)}
            </span>
          </li>
        ))}
      </ul>
      {extras.length > 0 ? (
        <fieldset className="mt-3 border-t border-sep pt-1">
          <legend className="sr-only">Add-ons for {o.label}</legend>
          {extras.map((l) => {
            const on = chosen.includes(l.id);
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant
              <label
                key={l.id}
                className="flex min-h-14 cursor-pointer items-center gap-3 py-1"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{l.name}</span>
                  <span className="num block text-footnote text-label-2">
                    Optional add-on · +{formatMoney(l.totalCents)}
                  </span>
                </span>
                <Toggle
                  checked={on}
                  label={`Add ${l.name}`}
                  onChange={(e) => onToggle(l.id, e.currentTarget.checked)}
                />
              </label>
            );
          })}
        </fieldset>
      ) : null}
      {o.depositCents ? (
        <p className="mt-2 text-footnote text-label-2">
          Deposit to book: {formatMoney(o.depositCents)}
        </p>
      ) : null}
    </article>
  );
}

/** Beside the signature pad: what is being approved. */
function ApprovalSummary({
  option: o,
  multi,
  total,
  addonIds,
}: {
  option: PortalOption;
  multi: boolean;
  total: number;
  addonIds: string[];
}) {
  const addons = o.lines.filter((l) => l.isOptional && addonIds.includes(l.id));
  const items = o.lines.filter((l) => !l.isOptional).length;
  return (
    <p className="px-1 text-footnote text-label-2">
      <span className="font-semibold text-label">
        {multi ? o.label : "Total"} · {formatMoney(total)}
      </span>
      {` · ${items} ${items === 1 ? "item" : "items"}`}
      {addons.length > 0 ? ` + ${addons.map((a) => a.name).join(", ")}` : ""}
      {o.depositCents
        ? ` · Deposit due next: ${formatMoney(o.depositCents)}`
        : ""}
    </p>
  );
}
