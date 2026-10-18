import { formatMoney } from "@/lib/money";
import { cx } from "../cx";

/**
 * Formats integer cents with `Intl` (SPEC §12.6). Always tabular numbers.
 *
 * @param statement accounting style: negatives in parentheses — `($12.50)`.
 * @param signed always show the sign (`+$5.00`, deltas).
 * @param colorize green for positive, red for negative (never the only signal:
 *   the sign/parentheses stay).
 */
export function MoneyText({
  cents,
  currency = "USD",
  locale = "en-US",
  statement,
  signed,
  compactWhole,
  colorize,
  className,
}: {
  cents: number | null | undefined;
  currency?: string;
  locale?: string;
  statement?: boolean;
  signed?: boolean;
  compactWhole?: boolean;
  colorize?: boolean;
  className?: string;
}) {
  const v = cents ?? 0;
  let text: string;
  if (statement && v < 0) {
    text = `(${formatMoney(-v, { currency, locale, compactWhole })})`;
  } else {
    text = formatMoney(v, { currency, locale, compactWhole, signed });
  }
  return (
    <span
      className={cx(
        "num whitespace-nowrap",
        colorize &&
          v > 0 &&
          "text-[color-mix(in_oklab,var(--sys-green)_70%,var(--label))]",
        colorize && v < 0 && "text-danger",
        className,
      )}
    >
      {cents == null ? "—" : text}
    </span>
  );
}
