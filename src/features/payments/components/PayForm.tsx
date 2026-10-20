"use client";

import { Lock } from "lucide-react";
import { useActionState, useState } from "react";
import { formatMoney } from "@/lib/money";
import { Banner } from "@/ui/components/Banner";
import { SubmitButton } from "@/ui/components/SubmitButton";
import { cx } from "@/ui/cx";
import { tipForPreset } from "../engine/fees";
import { startCheckout } from "../public-actions";

/** /p/[token] card checkout form: optional tip, then a redirect to the hosted page. */
export function PayForm({
  token,
  dueCents,
  feeLinesCents,
  tipPresets,
  tipOnFees,
  allowTip,
}: {
  token: string;
  dueCents: number;
  feeLinesCents: number;
  tipPresets: number[];
  tipOnFees: boolean;
  allowTip: boolean;
}) {
  const [state, formAction] = useActionState(startCheckout, null);
  const [pct, setPct] = useState(0);
  const tip = allowTip
    ? tipForPreset({ amountCents: dueCents, feeLinesCents, pct, tipOnFees })
    : 0;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="tipPct" value={pct} />
      {allowTip && (
        <fieldset className="card flex flex-col gap-3 p-5">
          <legend className="sr-only">Add a tip for your technician?</legend>
          <div aria-hidden>
            <p className="text-headline">Add a tip?</p>
            <p className="text-footnote text-label-2">
              Tips go 100% to your technician.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {tipPresets.map((p) => {
              const cents = tipForPreset({
                amountCents: dueCents,
                feeLinesCents,
                pct: p,
                tipOnFees,
              });
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pct === p}
                  onClick={() => setPct(p)}
                  className={cx(
                    "pressable flex min-h-14 flex-col items-center justify-center rounded-control text-subhead font-semibold transition-colors duration-[var(--dur-quick)]",
                    pct === p ? "bg-label text-bg" : "bg-field text-label",
                  )}
                >
                  {p === 0 ? "No tip" : `${p}%`}
                  {p > 0 && (
                    <span className="num text-caption opacity-80">
                      {formatMoney(cents)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {state && !state.ok && <Banner tone="error">{state.error}</Banner>}
      <SubmitButton size="lg" block icon={<Lock size={18} />}>
        Pay {formatMoney(dueCents + tip)} by card
      </SubmitButton>
      <p className="-mt-1 text-center text-footnote text-label-2">
        You'll finish on a secure card page. We never see your card number.
      </p>
    </form>
  );
}
