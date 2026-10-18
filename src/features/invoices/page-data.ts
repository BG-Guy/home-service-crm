import "server-only";
import { notFound } from "next/navigation";
import { contactRevealedFor } from "@/features/customers/api";
import { NotFoundError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import type { SessionUser } from "@/lib/types";
import { assertInvoiceAccess } from "./api";
import { type InvoiceDoc, loadInvoiceDoc } from "./doc";
import { maskInvoiceDoc } from "./masking";

// Page loaders: row-scoped access (assertInvoiceAccess) → the document, or a 404.
// ForbiddenError propagates to the app's error boundary ("You don't have access").
// Contact details are masked for viewers outside the contact window (SPEC §4.2).

export async function loadInvoiceForViewer(
  user: SessionUser,
  invoiceId: string,
  mode: "read" | "write" = "read",
): Promise<InvoiceDoc> {
  if (!isUuid(invoiceId)) notFound();
  try {
    await assertInvoiceAccess(user, invoiceId, mode);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const doc = await loadInvoiceDoc(invoiceId);
  if (!doc) notFound();
  const { revealed } = await contactRevealedFor(user, doc.customer.id);
  return revealed ? doc : maskInvoiceDoc(doc);
}
