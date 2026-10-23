"use server";

import { requireUser } from "@/lib/auth/current";
import type { DocPeek, DocPeekResult } from "@/lib/doc-cards";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { assertEstimateAccess } from "./access";
import { loadEstimateDocForViewer } from "./doc";

const LINES = 6;

/**
 * The estimate card's peek (/estimates card layout): the options and their totals,
 * the status dates, the job and the first lines of the approved, else recommended,
 * else first option. Same access rules and contact masking as the estimate page.
 */
export async function fetchEstimatePeek(id: string): Promise<DocPeekResult> {
  try {
    const user = await requireUser("estimates.view");
    if (!(await isEnabled("estimates")) || !isUuid(String(id ?? "")))
      return { ok: false, error: "This estimate isn't available." };
    await assertEstimateAccess(user, id, "read");
    const doc = await loadEstimateDocForViewer(user, id);
    if (!doc) return { ok: false, error: "This estimate isn't available." };
    const e = doc.estimate;
    const tz = doc.timezone;
    const opts = doc.options;
    const pick =
      opts.find((o) => o.id === e.approvedOptionId) ??
      opts.find((o) => o.recommended) ??
      opts[0];
    const lines = (pick?.lines ?? []).map((l) => ({
      name: l.name,
      qty: Number(l.qty),
      cents: l.totalCents,
    }));
    const now = new Date();
    const facts: DocPeek["facts"] = [];
    if (e.sentAt)
      facts.push({ label: "Sent", value: formatDate(e.sentAt, tz) });
    if (e.viewedAt)
      facts.push({ label: "Viewed", value: formatDate(e.viewedAt, tz) });
    if (e.approvedAt)
      facts.push({ label: "Approved", value: formatDate(e.approvedAt, tz) });
    if (e.declinedAt)
      facts.push({
        label: "Declined",
        value: `${formatDate(e.declinedAt, tz)}${e.declineReason ? ` · ${e.declineReason}` : ""}`,
      });
    if (e.expiresAt && !e.approvedAt && !e.declinedAt)
      facts.push({
        label: "Expires",
        value: formatDate(e.expiresAt, tz),
        tone: e.expiresAt < now ? "danger" : undefined,
      });
    if (doc.job) facts.push({ label: "Job", value: doc.job.number });
    if (doc.serviceType)
      facts.push({ label: "Job type", value: doc.serviceType.name });
    const address = doc.propertyLines.length
      ? doc.propertyLines.join(", ")
      : doc.propertyAreaLines.join(", ");
    if (address) facts.push({ label: "Address", value: address });
    return {
      ok: true,
      data: {
        id: e.id,
        kind: "estimate",
        status: e.status,
        title: e.title ? `${e.number} · ${e.title}` : e.number,
        amounts:
          opts.length > 1
            ? opts.map((o) => ({
                label: `${o.label}${o.id === e.approvedOptionId ? " · approved" : o.recommended ? " · recommended" : ""}`,
                cents: o.totals.totalCents,
                strong: o.id === pick?.id,
              }))
            : [
                {
                  label: "Total",
                  cents: pick?.totals.totalCents ?? doc.headlineCents,
                  strong: true,
                },
              ],
        facts,
        lines: lines.slice(0, LINES),
        moreLines: Math.max(0, lines.length - LINES),
        notes: e.notes,
        href: `/estimates/${e.id}`,
        openLabel: "Open estimate",
      },
    };
  } catch {
    return { ok: false, error: "Couldn't load this estimate." };
  }
}
