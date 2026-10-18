// The draft-invoice line made from a lead's quoted price (QA T2-12) is a PLACEHOLDER
// until the customer approves an estimate: estimates/api `linesToInvoice` replaces it
// with the approved lines (draft invoices only), so the customer is never billed the
// quote AND the estimate. The marker is the line's description; a line someone edited
// to a different description is theirs and stays. Pure, isomorphic.

export const LEAD_QUOTE_LINE_DESCRIPTION = "Price quoted on the lead";

/** Is this invoice line the untouched lead-quote placeholder? */
export function isLeadQuoteLine(l: {
  description: string | null;
  pricebookItemId: string | null;
  type: string;
}): boolean {
  return (
    l.description === LEAD_QUOTE_LINE_DESCRIPTION &&
    l.pricebookItemId == null &&
    l.type === "service"
  );
}
