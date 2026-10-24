// Invoice photo labels (Quote to Paid, the owner's note): every photo on an invoice
// says plainly whether it's Before, During or After. A "Problem" photo (what the tech
// found) is a Before; "Goal" photos belong to estimates and never go on invoices.
// Pure and client-safe: the invoice page, the photo picker and the document share it.
import type { MediaTag } from "@/features/media/contracts";
import type { Tone } from "@/ui/tone";

export type InvoicePhotoLabel = "Before" | "During" | "After" | "Photo";

/** Job photo tags that can go on an invoice (never "goal", receipts or documents). */
export const INVOICE_PHOTO_TAGS = [
  "before",
  "during",
  "after",
  "problem",
  "other",
] as const satisfies readonly MediaTag[];

/** The three labels a tech picks from for an invoice photo. */
export const INVOICE_LABEL_TAGS = ["before", "during", "after"] as const;
export type InvoiceLabelTag = (typeof INVOICE_LABEL_TAGS)[number];

export function isInvoicePhotoTag(tag: string | null | undefined): boolean {
  return (INVOICE_PHOTO_TAGS as readonly string[]).includes(tag ?? "");
}

/** "Before" / "During" / "After" for a photo on an invoice ("Photo" when untagged). */
export function invoicePhotoLabel(
  tag: string | null | undefined,
): InvoicePhotoLabel {
  switch (tag) {
    case "before":
    case "problem":
      return "Before";
    case "during":
      return "During";
    case "after":
      return "After";
    default:
      return "Photo";
  }
}

/** The label tag a photo shows as (problem → before); null when it has none of the three. */
export function invoiceLabelTag(
  tag: string | null | undefined,
): InvoiceLabelTag | null {
  const l = invoicePhotoLabel(tag);
  return l === "Photo" ? null : (l.toLowerCase() as InvoiceLabelTag);
}

/** Chip color per label, the same everywhere (document, page, picker). */
export const INVOICE_PHOTO_TONE: Record<InvoicePhotoLabel, Tone> = {
  Before: "orange",
  During: "blue",
  After: "green",
  Photo: "gray",
};
