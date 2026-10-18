import type { EstimateDoc } from "@/features/estimates/doc";
import { maskEmail, maskPhone } from "@/lib/mask";
import type { InvoiceDoc } from "./doc";

// Contact-window masking for staff views of documents (SPEC §4.2 notes). Outside a
// tech's active job window (customers/api `contactRevealedFor`), email and phone
// are masked and an address keeps only its area line ("Austin, TX 78701"), never
// the street. The customer-facing pages (/i/, /e/) are the customer's own record
// and are never masked. Pure: no DB, no server-only, so tests import it directly.

export interface AddressParts {
  street?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** "Austin, TX 78701": the part of an address shown outside the contact window. */
export function areaLine(a: AddressParts | null | undefined): string | null {
  if (!a) return null;
  const line = [a.city, [a.state, a.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return line || null;
}

/** Masks email and phone on a contact record. */
export function maskContact<
  T extends { email: string | null; phone: string | null },
>(c: T): T {
  return { ...c, email: maskEmail(c.email), phone: maskPhone(c.phone) };
}

/** The invoice document as a viewer outside the contact window sees it. */
export function maskInvoiceDoc(doc: InvoiceDoc): InvoiceDoc {
  return {
    ...doc,
    customer: maskContact(doc.customer),
    property: doc.property
      ? {
          addressLines: doc.property.areaLines,
          areaLines: doc.property.areaLines,
        }
      : null,
  };
}

/** The estimate document as a viewer outside the contact window sees it. */
export function maskEstimateDoc(doc: EstimateDoc): EstimateDoc {
  return {
    ...doc,
    customer: maskContact(doc.customer),
    propertyLines: doc.propertyAreaLines,
  };
}
