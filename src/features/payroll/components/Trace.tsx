import { formatMoney } from "@/lib/money";
import { cx } from "@/ui/cx";
import type { TraceStep } from "../contracts";

// "Why is my commission $80.75?" (SPEC §10.5): the engine trace as a receipt-style table.
// Pure markup (usable from server and client components).

const TOTALS = new Set(["base", "commission", "net", "company_net"]);

export function Trace({
  steps,
  className,
}: {
  steps: TraceStep[];
  className?: string;
}) {
  if (steps.length === 0)
    return <p className="text-subhead text-label-2">No breakdown yet.</p>;
  return (
    <dl className={cx("flex flex-col text-subhead", className)}>
      {steps.map((s, i) => {
        const total = TOTALS.has(s.step);
        const info =
          s.step === "rate" || s.step === "split" || s.step === "note";
        const sign = total
          ? "= "
          : info
            ? "× "
            : s.amount_cents < 0
              ? "− "
              : i === 0
                ? ""
                : "+ ";
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: traces are static lists
            key={i}
            className={cx(
              "flex items-baseline justify-between gap-4 py-1.5",
              total && "border-t border-sep font-semibold",
              info && "text-label-2",
            )}
          >
            <dt className="min-w-0">
              <span aria-hidden className="inline-block w-4 text-label-3">
                {sign.trim()}
              </span>
              {s.label}
            </dt>
            <dd className="num shrink-0 tabular-nums">
              {info
                ? ""
                : formatMoney(
                    total ? s.amount_cents : Math.abs(s.amount_cents),
                  )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
