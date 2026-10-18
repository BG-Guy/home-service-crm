import "server-only";
import type { Tx } from "@/db";
import {
  mintOrReusePublicToken,
  mintPublicToken,
  TOKEN_TTL,
} from "@/lib/tokens";

// Magic-link minting for B3 documents (SPEC M23). Raw tokens only ever live in the
// returned URL — never stored, logged or emitted. Lifetimes follow M23:
//   /j job: 30 d after completion (or the window end) · /e estimate: its expiry ·
//   /i invoice: 180 d · /p pay: 7 d (paper QR codes: until 30 d after the due date).

const DAY = 86_400_000;

export async function mintJobLink(
  tx: Tx,
  job: {
    id: string;
    customerId: string;
    completedAt?: Date | null;
    windowEnd?: Date | null;
  },
): Promise<string> {
  const anchor = Math.max(
    Date.now(),
    (job.completedAt ?? job.windowEnd ?? new Date()).getTime(),
  );
  const r = await mintPublicToken(tx, {
    kind: "job",
    entity: { type: "job", id: job.id },
    customerId: job.customerId,
    jobId: job.id,
    expiresAt: new Date(anchor + TOKEN_TTL.job),
  });
  return r.url;
}

export async function mintEstimateLink(
  tx: Tx,
  est: {
    id: string;
    customerId: string;
    jobId: string | null;
    expiresAt: Date | null;
  },
  entityType: "estimate" | "change_order" = "estimate",
): Promise<string> {
  const exp =
    est.expiresAt && est.expiresAt.getTime() > Date.now() + DAY
      ? est.expiresAt
      : new Date(Date.now() + TOKEN_TTL.estimate);
  const r = await mintPublicToken(tx, {
    kind: "estimate",
    entity: { type: entityType, id: est.id },
    customerId: est.customerId,
    jobId: est.jobId,
    expiresAt: exp,
  });
  return r.url;
}

export async function mintInvoicePortalLink(
  tx: Tx,
  inv: { id: string; customerId: string; jobId: string | null },
): Promise<string> {
  const r = await mintPublicToken(tx, {
    kind: "invoice",
    entity: { type: "invoice", id: inv.id },
    customerId: inv.customerId,
    jobId: inv.jobId,
  });
  return r.url;
}

/**
 * Lifetime for a printed pay QR (pure): long enough that the link outlives the paper
 * (30 days after the due date, never under the 7-day default). mintOrReusePublicToken
 * buckets by ttl/2 and a link has ttl/2..ttl left, so the ttl is twice the need,
 * rounded up to whole weeks: it only changes once a week, and re-rendering the print
 * page reuses the same token (QA T4-28) instead of minting a row per view.
 */
export function paperPayTtlMs(
  dueAt: Date | null | undefined,
  now: number,
): number {
  const need = dueAt ? dueAt.getTime() + 30 * DAY - now : 0;
  if (need <= TOKEN_TTL.pay / 2) return TOKEN_TTL.pay;
  const WEEK = 7 * DAY;
  return 2 * Math.ceil(need / WEEK) * WEEK;
}

/**
 * /p/ pay link for an invoice (B4 page). `forPaper` keeps a printed QR code alive
 * until 30 days after the due date (never less than the 7-day default) and reuses
 * one stable token per invoice across re-renders of the print page.
 */
export async function mintPayLink(
  tx: Tx,
  inv: {
    id: string;
    customerId: string;
    jobId: string | null;
    dueAt?: Date | null;
  },
  opts: { forPaper?: boolean } = {},
): Promise<string> {
  if (opts.forPaper) {
    const now = new Date();
    const r = await mintOrReusePublicToken(
      tx,
      {
        kind: "pay",
        entity: { type: "invoice", id: inv.id },
        customerId: inv.customerId,
        jobId: inv.jobId,
        purpose: "invoice.print",
        ttlMs: paperPayTtlMs(inv.dueAt, now.getTime()),
      },
      now,
    );
    return r.url;
  }
  const r = await mintPublicToken(tx, {
    kind: "pay",
    entity: { type: "invoice", id: inv.id },
    customerId: inv.customerId,
    jobId: inv.jobId,
    expiresAt: new Date(Date.now() + TOKEN_TTL.pay),
  });
  return r.url;
}
