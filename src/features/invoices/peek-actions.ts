"use server";

import { requireUser } from "@/lib/auth/current";
import type { DocPeek, DocPeekResult } from "@/lib/doc-cards";
import { isUuid } from "@/lib/ids";
import { formatDate } from "@/lib/time";
import { daysPastDue } from "./math";
import { loadInvoiceForViewer } from "./page-data";

const LINES = 6;

/**
 * The invoice card's peek (/invoices card layout): total, paid and the balance,
 * the dates (overdue in red), the job and techs, and the first lines. Same access
 * rules and contact masking as the invoice page.
 */
export async function fetchInvoicePeek(id: string): Promise<DocPeekResult> {
  try {
    const user = await requireUser("invoices.view");
    if (!isUuid(String(id ?? "")))
      return { ok: false, error: "This invoice isn't available." };
    const doc = await loadInvoiceForViewer(user, id);
    const inv = doc.invoice;
    const tz = doc.timezone;
    const now = new Date();
    const facts: DocPeek["facts"] = [];
    if (inv.issuedAt)
      facts.push({ label: "Issued", value: formatDate(inv.issuedAt, tz) });
    if (inv.dueAt && inv.balanceCents > 0 && inv.status !== "draft") {
      const days = inv.overdue ? daysPastDue(inv.dueAt, now, tz) : 0;
      facts.push({
        label: "Due",
        value: inv.overdue
          ? `${formatDate(inv.dueAt, tz)} · ${days} day${days === 1 ? "" : "s"} past due`
          : formatDate(inv.dueAt, tz),
        tone: inv.overdue ? "danger" : undefined,
      });
    }
    if (doc.job)
      facts.push({
        label: "Job",
        value: `${doc.job.number} · ${doc.job.title}`,
      });
    if (doc.techs.length)
      facts.push({
        label: doc.techs.length === 1 ? "Tech" : "Techs",
        value: doc.techs.map((t) => t.name).join(", "),
      });
    const address = doc.property
      ? (doc.property.addressLines.length
          ? doc.property.addressLines
          : doc.property.areaLines
        ).join(", ")
      : "";
    if (address) facts.push({ label: "Address", value: address });
    if (inv.version > 1)
      facts.push({ label: "Version", value: `v${inv.version}` });
    const lines = doc.lines
      .filter((l) => !l.isOptional || l.isSelected)
      .map((l) => ({ name: l.name, qty: l.qty, cents: l.totalCents }));
    const amounts: DocPeek["amounts"] = [
      { label: "Total", cents: inv.totalCents, strong: inv.status === "draft" },
    ];
    if (inv.status !== "draft") {
      // Payments and credits less refunds: what reconciles total and balance.
      const paid = inv.totalCents - inv.balanceCents;
      if (paid !== 0) amounts.push({ label: "Paid", cents: paid });
      amounts.push({
        label: "Balance",
        cents: inv.balanceCents,
        strong: true,
        tone: inv.overdue && inv.balanceCents > 0 ? "danger" : undefined,
      });
    }
    return {
      ok: true,
      data: {
        id: inv.id,
        kind: "invoice",
        status: inv.overdue ? "overdue" : inv.status,
        title: inv.number,
        amounts,
        facts,
        lines: lines.slice(0, LINES),
        moreLines: Math.max(0, lines.length - LINES),
        notes: inv.notes,
        href: `/invoices/${inv.id}`,
        openLabel: "Open invoice",
      },
    };
  } catch {
    return { ok: false, error: "Couldn't load this invoice." };
  }
}
