"use server";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  changeOrders,
  depositRequests,
  estimates,
  invoices,
  jobs,
} from "@/db/schema";
import {
  approveChangeOrderTx,
  approveEstimateTx,
  declineChangeOrderTx,
  declineEstimateTx,
} from "@/features/estimates/api";
import { actionFailure } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { processEventsSoon } from "@/lib/events";
import { mintPublicToken, type PortalAction } from "@/lib/tokens";
import type { ActionResult } from "@/lib/types";
import { mintEstimateLink, mintInvoicePortalLink, mintPayLink } from "./links";
import { presentingUser } from "./present";
import {
  assertPortalRate,
  logPortal,
  peekPublicToken,
  portalActor,
} from "./token";

// Public (no session) actions behind the /e /i /j pages (SPEC M23). action() needs
// a signed-in user, so each mirrors its steps by hand: zod → per-IP rate limit →
// token re-validation (hash, kind, expiry, revocation) → one transaction (write +
// events + audit + activity) → portal_access_log → refresh() → events after().

const Token = z.string().min(32).max(128);
const uuid = z.uuid();

const Sign = z.object({
  token: Token,
  signerName: z.string().trim().min(2, "Type your full name.").max(200),
  esignConsent: z.literal(true, {
    error: "Check the box to agree to sign electronically.",
  }),
  signatureMediaId: uuid,
  geo: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().nullable().optional(),
      at: z.string().optional(),
    })
    .nullable()
    .optional(),
  deviceTs: z.string().max(40),
  clientId: uuid,
});

const deviceDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

function done() {
  try {
    refresh();
  } catch {
    // outside a Server Action request
  }
}

async function tokenFor(
  token: string,
  entityType: "estimate" | "change_order" | "invoice" | "job",
) {
  const kind =
    entityType === "change_order"
      ? "estimate"
      : (entityType as "estimate" | "invoice" | "job");
  const row = await peekPublicToken([kind], token);
  if (!row || row.entityType !== entityType) throw new NotFoundError("Link");
  return row;
}

/**
 * /e/: the customer picks an option (+ add-ons), consents and signs. `present`
 * (present mode on a staff tablet): when a staff user who may present this
 * estimate is signed in on the device, the signature is recorded as given in
 * person, and the audit row names the presenting user.
 */
export async function approveEstimatePublic(
  raw: z.input<typeof Sign> & {
    optionId: string;
    addonIds: string[];
    present?: boolean;
  },
): Promise<ActionResult<{ signatureId: string; depositId: string | null }>> {
  try {
    const input = Sign.extend({
      optionId: uuid,
      addonIds: z.array(uuid).max(50),
      present: z.boolean().optional(),
    }).parse(raw);
    await assertPortalRate();
    const tok = await tokenFor(input.token, "estimate");
    const actor = await portalActor(tok);
    const presenter = input.present ? await presentingUser(tok.entityId) : null;
    const channel = presenter ? "in_person" : "remote_link";
    const res = await db.transaction(async (tx) => {
      const r = await approveEstimateTx(
        tx,
        {
          estimateId: tok.entityId,
          optionId: input.optionId,
          addonIds: input.addonIds,
          sign: {
            signerName: input.signerName,
            signatureMediaId: input.signatureMediaId,
            channel,
            esignConsent: true,
            geo: input.geo ?? null,
            deviceTs: deviceDate(input.deviceTs),
            tokenId: tok.id,
            ip: actor.ip ?? null,
            userAgent: actor.userAgent ?? null,
          },
        },
        actor,
      );
      await writeAudit(tx, {
        actor,
        action: "estimate.approved",
        entity: { type: "estimate", id: tok.entityId },
        after: {
          option_id: input.optionId,
          addon_ids: input.addonIds,
          signature_id: r.signatureId,
          channel,
          ...(presenter
            ? {
                present_mode: true,
                presented_by: presenter.id,
                presented_by_name: presenter.name,
              }
            : {}),
        },
        full: true,
      });
      return r;
    });
    await logPortal(tok, "/e/[token]", "signed");
    await logPortal(tok, "/e/[token]", "approved");
    done();
    await processEventsSoon();
    return {
      ok: true,
      data: {
        signatureId: res.signatureId ?? "",
        depositId:
          res.deposit &&
          !["paid", "applied", "held", "waived"].includes(res.deposit.status)
            ? res.deposit.id
            : null,
      },
    };
  } catch (e) {
    return actionFailure(e);
  }
}

/** /e/ for a change order (B5 mints those links as kind 'estimate'). */
export async function approveChangeOrderPublic(
  raw: z.input<typeof Sign>,
): Promise<ActionResult<{ signatureId: string }>> {
  try {
    const input = Sign.parse(raw);
    await assertPortalRate();
    const tok = await tokenFor(input.token, "change_order");
    const actor = await portalActor(tok);
    const r = await db.transaction(async (tx) => {
      const out = await approveChangeOrderTx(
        tx,
        {
          changeOrderId: tok.entityId,
          sign: {
            signerName: input.signerName,
            signatureMediaId: input.signatureMediaId,
            channel: "remote_link",
            esignConsent: true,
            geo: input.geo ?? null,
            deviceTs: deviceDate(input.deviceTs),
            tokenId: tok.id,
            ip: actor.ip ?? null,
            userAgent: actor.userAgent ?? null,
          },
        },
        actor,
      );
      await writeAudit(tx, {
        actor,
        action: "change_order.approved",
        entity: { type: "change_order", id: tok.entityId },
        after: { signature_id: out.signatureId, channel: "remote_link" },
        full: true,
      });
      return out;
    });
    await logPortal(tok, "/e/[token]", "signed");
    await logPortal(tok, "/e/[token]", "approved");
    done();
    await processEventsSoon();
    return { ok: true, data: { signatureId: r.signatureId } };
  } catch (e) {
    return actionFailure(e);
  }
}

/** /e/: "No thanks" with an optional reason (estimate or change order). */
export async function declinePublic(raw: {
  token: string;
  reason?: string | null;
}): Promise<ActionResult> {
  try {
    const input = z
      .object({ token: Token, reason: z.string().trim().max(500).nullish() })
      .parse(raw);
    await assertPortalRate();
    const row = await peekPublicToken(["estimate"], input.token);
    if (!row) throw new NotFoundError("Link");
    const actor = await portalActor(row);
    await db.transaction(async (tx) => {
      if (row.entityType === "change_order")
        await declineChangeOrderTx(
          tx,
          row.entityId,
          input.reason ?? null,
          actor,
        );
      else if (row.entityType === "estimate")
        await declineEstimateTx(tx, row.entityId, input.reason ?? null, actor);
      else throw new NotFoundError("Link");
      await writeAudit(tx, {
        actor,
        action: `${row.entityType}.declined`,
        entity: { type: row.entityType as "estimate", id: row.entityId },
        after: { reason: input.reason ?? null },
        full: true,
      });
    });
    await logPortal(row, "/e/[token]", "declined");
    done();
    await processEventsSoon();
    return { ok: true };
  } catch (e) {
    return actionFailure(e);
  }
}

// ------------------------------------------------------------------ navigation (pay, open docs)

async function go(
  token: string,
  kinds: ("estimate" | "invoice" | "job")[],
  log: PortalAction,
  path: string,
  pick: (
    row: NonNullable<Awaited<ReturnType<typeof peekPublicToken>>>,
  ) => Promise<string | null>,
): Promise<never> {
  Token.parse(token);
  await assertPortalRate();
  const row = await peekPublicToken(kinds, token);
  if (!row) redirect(path.replace("[token]", token));
  const url = await pick(row);
  await logPortal(row, path, log);
  if (!url) redirect(path.replace("[token]", token));
  redirect(url);
}

/** /e/ after approval: pay the required deposit (B4 /p/ page). */
export async function payDepositFromPortal(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await go(token, ["estimate"], "pay_opened", "/e/[token]", async (row) => {
    const [est] = await db
      .select({
        id: estimates.id,
        customerId: estimates.customerId,
        jobId: estimates.jobId,
      })
      .from(estimates)
      .where(eq(estimates.id, row.entityId))
      .limit(1);
    if (!est) return null;
    const [dep] = await db
      .select({ id: depositRequests.id, jobId: depositRequests.jobId })
      .from(depositRequests)
      .where(
        and(
          eq(depositRequests.estimateId, est.id),
          inArray(depositRequests.status, ["required", "requested"]),
        ),
      )
      .orderBy(desc(depositRequests.createdAt))
      .limit(1);
    if (!dep) return null;
    return db.transaction(async (tx) => {
      const r = await mintPublicToken(tx, {
        kind: "pay",
        entity: { type: "deposit_request", id: dep.id },
        customerId: est.customerId,
        jobId: dep.jobId ?? est.jobId,
      });
      return r.url;
    });
  });
}

/** /i/ and /j/: pay the open balance (mints a fresh 7-day /p/ link). */
export async function payInvoiceFromPortal(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const from = String(formData.get("from") ?? "i") === "j" ? "j" : "i";
  await go(
    token,
    from === "j" ? ["job"] : ["invoice"],
    "pay_opened",
    `/${from}/[token]`,
    async (row) => {
      const where =
        row.entityType === "invoice"
          ? eq(invoices.id, row.entityId)
          : and(
              eq(invoices.jobId, row.jobId ?? row.entityId),
              ne(invoices.status, "void"),
            );
      const [inv] = await db
        .select({
          id: invoices.id,
          customerId: invoices.customerId,
          jobId: invoices.jobId,
          status: invoices.status,
        })
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.createdAt))
        .limit(1);
      if (!inv || !["issued", "partially_paid"].includes(inv.status))
        return null;
      return db.transaction((tx) => mintPayLink(tx, inv));
    },
  );
}

/** /j/: open the job's estimate or invoice (mints the matching magic link). */
export async function openJobDocument(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const target = String(formData.get("target") ?? "");
  await go(token, ["job"], "viewed", "/j/[token]", async (row) => {
    const jobId = row.jobId ?? row.entityId;
    const [job] = await db
      .select({ id: jobs.id, customerId: jobs.customerId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!job) return null;
    if (target === "estimate") {
      const [est] = await db
        .select({
          id: estimates.id,
          customerId: estimates.customerId,
          jobId: estimates.jobId,
          expiresAt: estimates.expiresAt,
        })
        .from(estimates)
        .where(and(eq(estimates.jobId, job.id), ne(estimates.status, "draft")))
        .orderBy(desc(estimates.createdAt))
        .limit(1);
      if (!est) return null;
      return db.transaction((tx) => mintEstimateLink(tx, est));
    }
    if (target === "change_order") {
      const coId = String(formData.get("id") ?? "");
      if (!uuid.safeParse(coId).success) return null;
      const [co] = await db
        .select({ id: changeOrders.id })
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.id, coId),
            eq(changeOrders.jobId, job.id),
            ne(changeOrders.status, "draft"),
          ),
        )
        .limit(1);
      if (!co) return null;
      return db.transaction((tx) =>
        mintEstimateLink(
          tx,
          {
            id: co.id,
            customerId: job.customerId,
            jobId: job.id,
            expiresAt: null,
          },
          "change_order",
        ),
      );
    }
    const [inv] = await db
      .select({
        id: invoices.id,
        customerId: invoices.customerId,
        jobId: invoices.jobId,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.jobId, job.id),
          inArray(invoices.status, ["issued", "partially_paid", "paid"]),
        ),
      )
      .orderBy(desc(invoices.createdAt))
      .limit(1);
    if (!inv) return null;
    return db.transaction((tx) => mintInvoicePortalLink(tx, inv));
  });
}
