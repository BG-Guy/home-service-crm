// Plain words for the "Get paid" sheet (Quote to Paid I2/I3). Pure and client-safe;
// pinned by tests/golden/collect-copy.test.ts.
import { formatMoney } from "@/lib/money";

/**
 * Why there's nothing to collect. An empty draft is not "paid in full" (it has no
 * items yet), and a $0 draft is a no-charge invoice, not a paid one.
 */
export function nothingDueMessage(i: {
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceHasLines: boolean;
  totalCents: number;
}): string {
  if (!i.invoiceNumber) return "There's no invoice or deposit to collect yet.";
  if (i.invoiceStatus === "draft")
    return !i.invoiceHasLines
      ? `Nothing to collect yet. Add items to ${i.invoiceNumber} first.`
      : i.totalCents <= 0
        ? `${i.invoiceNumber} totals ${formatMoney(0)}, so there's nothing to collect.`
        : `Deposits and payments already cover ${i.invoiceNumber}.`;
  if (i.invoiceStatus === "void") return `${i.invoiceNumber} was voided.`;
  if (i.invoiceStatus === "uncollectible")
    return `${i.invoiceNumber} was written off.`;
  return `${i.invoiceNumber} is paid in full.`;
}
