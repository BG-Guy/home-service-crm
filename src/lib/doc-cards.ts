// Shared shapes for the card layout of the document lists (estimates, invoices):
// the server pages build `DocCard`s, the peek actions return a `DocPeek` (plain
// module, client-safe). Jobs have their own card (features/jobs JobBox).

export type DocKind = "estimate" | "invoice";

export interface DocCard {
  id: string;
  kind: DocKind;
  /** The full page. */
  href: string;
  /** StatusPill status for `kind` ("overdue" for a late invoice). */
  status: string;
  /** The amount on the card (invoices: the balance while one is due). */
  amountCents: number;
  /** Under the amount: "of $1,200", "Balance". */
  amountNote: string | null;
  /** The customer. */
  title: string;
  /** "E-1042 · Rekey 3 locks". */
  subtitle: string;
  /** "Sent Oct 21 · J-1044 · Derek". */
  meta: string;
  /** Meta in the danger ink (overdue, past expiry). */
  alert: boolean;
  customerId: string;
  jobHref: string | null;
  jobNumber: string | null;
  canText: boolean;
}

export interface DocPeek {
  id: string;
  title: string;
  status: string;
  kind: DocKind;
  /** Money rows on top: Total, Paid, Balance; or each option. */
  amounts: {
    label: string;
    cents: number;
    strong?: boolean;
    tone?: "danger";
  }[];
  facts: { label: string; value: string; tone?: "danger" }[];
  /** The first lines (the rest is on the full page). */
  lines: { name: string; qty: number; cents: number }[];
  moreLines: number;
  notes: string | null;
  href: string;
  openLabel: string;
}

export type DocPeekResult =
  | { ok: true; data: DocPeek }
  | { ok: false; error: string };

export type DocLayout = "cards" | "list";

export function parseDocLayout(v: string | null | undefined): DocLayout {
  return v === "list" ? "list" : "cards";
}
