"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { optionTotals } from "@/features/estimates/logic";
import type { DocLineType } from "@/features/invoices/math";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { formatMoney } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import {
  approveChangeOrderPublic,
  approveEstimatePublic,
  declinePublic,
} from "../actions";

// The customer's side of /e/[token] (SPEC M07/M23): choose an option, tick add-ons,
// see the total update, then the ESIGN consent + typed name + drawn signature (S15,
// uploaded through the magic-link route). Decline with an optional reason.

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

  return (
    <>
      <fieldset className="space-y-3">
        <legend className="sr-only">
          {options.length > 1 ? "Choose an option" : "Your estimate"}
        </legend>
        {options.map((o) => {
          const selected = o.id === pickId;
          const required = o.lines.filter((l) => !l.isOptional);
          const extras = o.lines.filter((l) => l.isOptional);
          return (
            <div
              key={o.id}
              className={cx(
                "relative rounded-card bg-card p-4 shadow-card transition-[box-shadow] duration-300 ease-[var(--ease-spring-snappy)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                selected && options.length > 1
                  ? "ring-2 ring-accent"
                  : "ring-0",
              )}
            >
              <label
                className={cx("block", options.length > 1 && "cursor-pointer")}
              >
                <input
                  type="radio"
                  name="estimate-option"
                  value={o.id}
                  checked={selected}
                  onChange={() => setPickId(o.id)}
                  className="sr-only"
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-headline">
                      {o.label}
                      {o.recommended && options.length > 1 ? (
                        <span className="ml-2 rounded-pill bg-accent px-2 py-0.5 align-middle text-caption font-semibold text-on-accent">
                          Recommended
                        </span>
                      ) : null}
                    </p>
                    {o.notes ? (
                      <p className="mt-0.5 text-subhead text-label-2">
                        {o.notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="num text-title3 font-semibold">
                      {formatMoney(totals[o.id] ?? 0)}
                    </span>
                    {options.length > 1 ? (
                      <span
                        aria-hidden
                        className={cx(
                          "flex size-6 items-center justify-center rounded-full border-2",
                          selected
                            ? "border-accent bg-accent text-on-accent"
                            : "border-sep",
                        )}
                      >
                        {selected ? <Check size={14} strokeWidth={3} /> : null}
                      </span>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5 text-subhead">
                  {required.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {l.name}
                        {l.qty !== 1 ? (
                          <span className="text-label-2">
                            {" "}
                            × {qtyFmt.format(l.qty)}
                          </span>
                        ) : null}
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
                          "num shrink-0",
                          l.type === "discount" && "text-success",
                        )}
                      >
                        {formatMoney(l.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </label>
              {extras.length > 0 ? (
                <fieldset className="mt-3 border-t border-sep pt-3">
                  <legend className="sr-only">Add-ons for {o.label}</legend>
                  <p className="pb-1 text-footnote font-semibold uppercase text-label-2">
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
                          className="size-6 shrink-0 accent-[var(--accent)]"
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
                <p className="mt-3 text-footnote text-label-2">
                  Deposit to book: {formatMoney(o.depositCents)}
                </p>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      {coolingOff ? (
        <p className="mt-4 rounded-card bg-[color-mix(in_srgb,var(--sys-indigo)_12%,transparent)] p-4 text-subhead">
          You may cancel this transaction, without any penalty or obligation,
          within three business days from the date you sign. The full notice is
          below.
        </p>
      ) : null}

      {/* Sticky approve bar */}
      <div className="sticky bottom-0 z-10 -mx-[var(--gutter)] mt-6 border-t border-sep bg-[var(--bar)] px-[var(--gutter)] pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-xl print:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-footnote text-label-2">
              {pick?.label ?? "Total"}
            </p>
            <p className="num text-title3 font-semibold">
              {formatMoney(total)}
            </p>
          </div>
          <Button
            size="lg"
            disabled={!pick || pick.lines.length === 0}
            onClick={() => setSigning(true)}
          >
            Approve & sign
          </Button>
        </div>
        <button
          type="button"
          className="mt-2 min-h-11 w-full text-subhead text-label-2 underline-offset-2 hover:underline"
          onClick={() => setDeclining(true)}
        >
          No thanks
        </button>
      </div>

      {pick ? (
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
      <DeclineCustomerSheet
        open={declining}
        onClose={() => setDeclining(false)}
        token={token}
        onDone={() => router.refresh()}
      />
    </>
  );
}

function DeclineCustomerSheet({
  open,
  onClose,
  token,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Not right now?"
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Back
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <p className="px-1 text-subhead text-label-2">
          Tell us why (optional) — we read every answer and won't keep following
          up.
        </p>
        <TextArea
          label="Reason"
          hideLabel
          value={reason}
          rows={3}
          onChange={(e) => setReason(e.currentTarget.value)}
          placeholder="Price, timing, getting other quotes…"
        />
        <Button
          variant="gray"
          size="lg"
          fullWidth
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await declinePublic({ token, reason: reason || null });
              if (r.ok) {
                toast({ title: "Thanks for letting us know", tone: "success" });
                onClose();
                onDone();
              } else toast({ title: r.error, tone: "error" });
            })
          }
        >
          Decline estimate
        </Button>
      </div>
    </Sheet>
  );
}
