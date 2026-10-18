"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { cx } from "@/ui/cx";
import type { PaymentListRow } from "../contracts";
import { VerifyButton } from "./PaymentActions";

/** Unverified manual payments with multi-select "Verify" (payments.verify_manual). */
export function VerifyList({
  rows,
  canVerify,
  dates,
}: {
  rows: PaymentListRow[];
  canVerify: boolean;
  /** Pre-formatted dates by payment id (company time zone). */
  dates: Record<string, string>;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const all = sel.length === rows.length && rows.length > 0;
  return (
    <div className="flex flex-col gap-2">
      {canVerify && (
        <div className="flex items-center justify-between gap-2 px-4">
          <label className="flex min-h-11 items-center gap-2 text-subhead">
            <input
              type="checkbox"
              className="size-5 accent-[var(--accent)]"
              checked={all}
              onChange={() => setSel(all ? [] : rows.map((r) => r.id))}
            />
            Select all
          </label>
          <VerifyButton
            paymentIds={sel}
            label={sel.length ? `Verify ${sel.length}` : "Verify"}
          />
        </div>
      )}
      <ul className="list-card">
        {rows.map((p) => {
          const on = sel.includes(p.id);
          return (
            <li key={p.id} className="list-row">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox input is a descendant */}
              <label
                className={cx(
                  "flex min-h-11 items-center gap-3 px-4 py-2.5",
                  canVerify && "cursor-pointer",
                )}
              >
                {canVerify && (
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--accent)]"
                    checked={on}
                    onChange={() =>
                      setSel((s) =>
                        on ? s.filter((x) => x !== p.id) : [...s, p.id],
                      )
                    }
                    aria-label={`Select ${p.methodLabel} ${formatMoney(p.amountCents + p.tipCents)} from ${p.customerName}`}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body">
                    {p.customerName}
                    {p.jobNumber ? ` · ${p.jobNumber}` : ""}
                  </span>
                  <span className="block truncate text-footnote text-label-2">
                    {p.methodLabel}
                    {p.reference ? ` #${p.reference}` : ""} · {dates[p.id]}
                    {p.collectedByName ? ` · ${p.collectedByName}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="num text-body font-semibold">
                    {formatMoney(p.amountCents + p.tipCents)}
                  </span>
                  {p.staleUnverified && (
                    <span className="text-caption font-semibold text-danger">
                      Overdue
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
