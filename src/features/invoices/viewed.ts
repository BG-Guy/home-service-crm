import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { activity, invoices } from "@/db/schema";
import { contactRevealedFor } from "@/features/customers/api";
import { peekPublicToken } from "@/features/portal/token";
import { writeActivity } from "@/lib/activity";
import { getCurrentUser } from "@/lib/auth/current";
import { emit } from "@/lib/events";
import type { PublicTokenRow } from "@/lib/tokens";
import type { Actor } from "@/lib/types";
import { assertInvoiceAccess } from "./api";
import { type InvoiceDoc, loadInvoiceDoc } from "./doc";
import { maskInvoiceDoc } from "./masking";

// The customer opening their invoice (Quote to Paid I6/I7): the first real view of an
// issued invoice emits `invoice.viewed` (Part J's alert) and says so on the timeline;
// a staff preview (`/i/…?preview=1` with a staff session) never counts, never logs
// an access row and never alerts anyone.

/**
 * First customer view of an issued invoice: emits `invoice.viewed` { invoice_id,
 * token_id } and writes the activity "Customer opened invoice INV-1067". Once per
 * invoice, without a migration: an earlier `invoice.viewed` activity row means it
 * was already seen (the invoice row is locked, so two first views can't both win).
 * Drafts and voided invoices never count. Returns whether this view was the first.
 */
export async function markInvoiceViewed(
  tx: Tx,
  invoiceId: string,
  tokenId: string,
  actor: Actor,
): Promise<boolean> {
  const [inv] = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      customerId: invoices.customerId,
      jobId: invoices.jobId,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .for("update")
    .limit(1);
  if (!inv || inv.status === "draft" || inv.status === "void") return false;
  const [seen] = await tx
    .select({ id: activity.id })
    .from(activity)
    .where(
      and(
        eq(activity.entityType, "invoice"),
        eq(activity.entityId, inv.id),
        eq(activity.kind, "invoice.viewed"),
      ),
    )
    .limit(1);
  if (seen) return false;
  const entity = { type: "invoice", id: inv.id } as const;
  await emit(
    tx,
    "invoice.viewed",
    entity,
    { invoice_id: inv.id, token_id: tokenId },
    { actor },
  );
  await writeActivity(tx, {
    entity,
    customerId: inv.customerId,
    jobId: inv.jobId,
    kind: "invoice.viewed",
    summary: `Customer opened invoice ${inv.number}`,
    data: { token_id: tokenId },
    actorUserId: null,
  });
  return true;
}

/**
 * The staff user previewing invoice link `token` (`?preview=1`), or null: a signed-in
 * user who may see this invoice. The token is only peeked at (no access-log row, no
 * use count). Anyone else gets the normal customer page. `doc` is the invoice as this
 * user may see it: outside their contact window the customer's email, phone and
 * street are masked, exactly as on the staff invoice screen (SPEC §4.2).
 */
export async function invoicePreviewer(
  token: string,
): Promise<{ tok: PublicTokenRow; name: string; doc: InvoiceDoc } | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user || !user.perms.has("invoices.view")) return null;
  const tok = await peekPublicToken(["invoice"], token);
  if (!tok || tok.entityType !== "invoice") return null;
  try {
    await assertInvoiceAccess(user, tok.entityId, "read");
  } catch {
    return null;
  }
  const doc = await loadInvoiceDoc(tok.entityId);
  if (!doc) return null;
  const { revealed } = await contactRevealedFor(user, doc.customer.id);
  return { tok, name: user.name, doc: revealed ? doc : maskInvoiceDoc(doc) };
}

/** A signed-in staff user is looking (their opening of a link isn't the customer's). */
export async function isStaffViewer(): Promise<boolean> {
  return !!(await getCurrentUser().catch(() => null));
}
