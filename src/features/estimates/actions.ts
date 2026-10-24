"use server";

import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  changeOrders,
  estimateOptions,
  estimates,
  lineItems,
  properties,
} from "@/db/schema";
import { assertCustomerAccess } from "@/features/customers/api";
import { insertLines, lineValues } from "@/features/invoices/api";
import {
  assertDiscountAllowed,
  LineSchema,
  mathLines,
  toLineInput,
} from "@/features/invoices/lines";
import { assertJobAccess } from "@/features/jobs/api";
import { getLeadPrefill } from "@/features/leads/api";
import { enqueueMessage } from "@/features/messaging/api";
import {
  mintEstimateLink,
  mintEstimatePresentLink,
} from "@/features/portal/links";
import { action, zf } from "@/lib/action";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { assertChangeOrderAccess, assertEstimateAccess } from "./access";
import {
  approveChangeOrderTx,
  approveEstimateTx,
  createChangeOrderTx,
  createEstimateDraft,
  declineChangeOrderTx,
  declineEstimateTx,
  loadChangeOrder,
  loadEstimate,
  markEstimateSent,
  recomputeChangeOrder,
} from "./api";
import { isEstimateOpen } from "./logic";

// Estimate + change-order mutations (SPEC M07). Every action: perm + feature flag
// ('estimates') + zod + row scope + one transaction with audit/activity/events.

const F = "estimates" as const;
const uuid = z.uuid();

const estPaths = (id: string, jobId?: string | null) => [
  `/estimates/${id}`,
  "/estimates",
  ...(jobId ? [`/jobs/${jobId}`, "/today"] : []),
];
const coPaths = (id: string, jobId: string) => [
  `/estimates/co/${id}`,
  `/jobs/${jobId}`,
];

async function openEstimateOrThrow(tx: Tx, estimateId: string) {
  const [e] = await tx
    .select()
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!e) throw new NotFoundError("Estimate");
  if (!isEstimateOpen(e.status))
    throw new ConflictError(
      "estimate_closed",
      e.status === "superseded"
        ? `Estimate ${e.number} was replaced by another estimate on the job. Reopen it to change it.`
        : `Estimate ${e.number} is ${e.status} and can't be changed.`,
    );
  return e;
}

async function optionWithEstimate(tx: Tx, optionId: string) {
  const [o] = await tx
    .select()
    .from(estimateOptions)
    .where(eq(estimateOptions.id, optionId))
    .limit(1);
  if (!o) throw new NotFoundError("Option");
  return o;
}

// ------------------------------------------------------------------ create & edit

export const createEstimate = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    customer: z.object({
      customerId: uuid,
      propertyId: z.preprocess(
        (v) => (v === "" ? null : v),
        uuid.nullable().optional(),
      ),
    }),
    jobId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
    leadId: z.preprocess((v) => (v === "" ? undefined : v), uuid.optional()),
    title: zf.optionalText(200),
  }),
  audit: "estimate.created",
  async run({ input, user, tx, actor }) {
    const customerId = input.customer.customerId;
    await assertCustomerAccess(user, customerId, "read");
    if (input.jobId) await assertJobAccess(user, input.jobId, "read");
    // Every id in the input must belong to this customer (QA T5-09).
    if (input.customer.propertyId) {
      const [p] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.id, input.customer.propertyId),
            eq(properties.customerId, customerId),
            isNull(properties.deletedAt),
          ),
        )
        .limit(1);
      if (!p)
        throw new ValidationError({
          propertyId: ["Pick one of this customer's addresses."],
        });
    }
    // Sending or approving the estimate books the lead, so linking one needs the
    // permission to convert leads.
    if (input.leadId && !user.perms.has("leads.convert"))
      throw new ForbiddenError(undefined, "leads.convert");
    const lead = input.leadId ? await getLeadPrefill(input.leadId, user) : null;
    if (input.leadId && !lead) throw new NotFoundError("Lead");
    if (lead?.customerId && lead.customerId !== customerId)
      throw new ValidationError({
        leadId: ["That lead belongs to another customer."],
      });
    return createEstimateDraft(
      tx,
      {
        customerId: input.customer.customerId,
        propertyId: input.customer.propertyId ?? lead?.propertyId ?? null,
        jobId: input.jobId ?? null,
        leadId: lead ? input.leadId : null,
        title: input.title ?? lead?.serviceText ?? null,
        prefill: lead
          ? {
              serviceTypeId: lead.serviceTypeId,
              quotedPriceCents: lead.quotedPriceCents,
              notes: lead.notes,
            }
          : undefined,
      },
      actor,
    );
  },
  auditEntity: ({ data }) => ({ type: "estimate", id: data.estimateId }),
  revalidate: ({ input, data }) => estPaths(data.estimateId, input.jobId),
});

export const updateEstimateInfo = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    estimateId: uuid,
    title: z.string().trim().max(200).nullable(),
    notes: z.string().trim().max(4000).nullable(),
    warrantyText: z.string().trim().max(2000).nullable(),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  }),
  audit: "estimate.updated",
  async run({ input, user, tx }) {
    await assertEstimateAccess(user, input.estimateId, "write");
    const e = await openEstimateOrThrow(tx, input.estimateId);
    const expiresAt = input.expiresOn
      ? new Date(`${input.expiresOn}T23:59:00`)
      : e.expiresAt;
    if (expiresAt && expiresAt.getTime() < Date.now() - 86_400_000)
      throw new ValidationError({ expiresOn: ["Pick a future date."] });
    await tx
      .update(estimates)
      .set({
        title: input.title || null,
        notes: input.notes || null,
        warrantyText: input.warrantyText || null,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, e.id));
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

export const addEstimateOption = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ estimateId: uuid, copyFromOptionId: uuid.optional() }),
  audit: "estimate.option_added",
  async run({ input, user, tx }) {
    await assertEstimateAccess(user, input.estimateId, "write");
    const e = await openEstimateOrThrow(tx, input.estimateId);
    const opts = await tx
      .select()
      .from(estimateOptions)
      .where(eq(estimateOptions.estimateId, e.id))
      .orderBy(asc(estimateOptions.sort));
    if (opts.length >= 3)
      throw new ConflictError(
        "max_options",
        "Up to 3 options (Good, Better, Best).",
      );
    const labels = (await getSettings()).estimates.option_labels;
    const used = new Set(opts.map((o) => o.label));
    const label =
      labels.find((l) => !used.has(l)) ?? `Option ${opts.length + 1}`;
    const [row] = await tx
      .insert(estimateOptions)
      .values({
        estimateId: e.id,
        label,
        sort: (opts.at(-1)?.sort ?? -1) + 1,
        recommended: opts.length === 0,
      })
      .returning({ id: estimateOptions.id });
    if (!row) throw new Error("option insert failed");
    if (input.copyFromOptionId) {
      const src = opts.find((o) => o.id === input.copyFromOptionId);
      if (src) {
        const lines = await tx
          .select()
          .from(lineItems)
          .where(
            and(
              eq(lineItems.parentType, "estimate_option"),
              eq(lineItems.parentId, src.id),
            ),
          )
          .orderBy(asc(lineItems.sort));
        await insertLines(
          tx,
          "estimate_option",
          row.id,
          lines.map((l) => ({
            ...toLineInput({
              type: l.type as never,
              pricebookItemId: l.pricebookItemId,
              name: l.name,
              description: l.description,
              qty: Number(l.qty),
              unitPriceCents: l.unitPriceCents,
              unitCostCents: l.unitCostCents,
              discountCents: l.discountCents,
              taxable: l.taxable,
              partSource: l.partSource as never,
              warrantyDays: l.warrantyDays,
              manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
              serial: l.serial,
              isServiceFee: l.isServiceFee,
              isUpsell: l.isUpsell,
            }),
            isOptional: l.isOptional,
            isSelected: l.isSelected,
          })),
        );
      }
    }
    return { estimateId: e.id, optionId: row.id, jobId: e.jobId };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

export const updateEstimateOption = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    optionId: uuid,
    label: z.string().trim().min(1, "Enter a label.").max(40),
    recommended: z.boolean(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }),
  audit: "estimate.option_updated",
  async run({ input, user, tx }) {
    const o = await optionWithEstimate(tx, input.optionId);
    await assertEstimateAccess(user, o.estimateId, "write");
    const e = await openEstimateOrThrow(tx, o.estimateId);
    if (input.recommended)
      await tx
        .update(estimateOptions)
        .set({ recommended: false, updatedAt: new Date() })
        .where(
          and(
            eq(estimateOptions.estimateId, e.id),
            ne(estimateOptions.id, o.id),
          ),
        );
    await tx
      .update(estimateOptions)
      .set({
        label: input.label,
        recommended: input.recommended,
        notes: input.notes ?? o.notes,
        updatedAt: new Date(),
      })
      .where(eq(estimateOptions.id, o.id));
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ data }) => ({ type: "estimate", id: data.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

export const deleteEstimateOption = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ optionId: uuid }),
  audit: "estimate.option_removed",
  async run({ input, user, tx }) {
    const o = await optionWithEstimate(tx, input.optionId);
    await assertEstimateAccess(user, o.estimateId, "write");
    const e = await openEstimateOrThrow(tx, o.estimateId);
    const all = await tx
      .select({ id: estimateOptions.id })
      .from(estimateOptions)
      .where(eq(estimateOptions.estimateId, e.id));
    if (all.length <= 1)
      throw new ConflictError(
        "last_option",
        "An estimate needs at least one option.",
      );
    await tx
      .delete(lineItems)
      .where(
        and(
          eq(lineItems.parentType, "estimate_option"),
          eq(lineItems.parentId, o.id),
        ),
      );
    await tx.delete(estimateOptions).where(eq(estimateOptions.id, o.id));
    if (o.recommended) {
      const next = all.find((a) => a.id !== o.id);
      if (next)
        await tx
          .update(estimateOptions)
          .set({ recommended: true, updatedAt: new Date() })
          .where(eq(estimateOptions.id, next.id));
    }
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ data }) => ({ type: "estimate", id: data.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

async function saveLine(
  tx: Tx,
  user: Parameters<typeof assertDiscountAllowed>[0],
  parentType: "estimate_option" | "change_order",
  parentId: string,
  line: z.infer<typeof LineSchema>,
): Promise<string | null> {
  const existing = await tx
    .select()
    .from(lineItems)
    .where(
      and(
        eq(lineItems.parentType, parentType),
        eq(lineItems.parentId, parentId),
      ),
    );
  const values = {
    ...lineValues(toLineInput(line)),
    isOptional:
      parentType === "estimate_option" ? (line.isOptional ?? false) : false,
    isSelected: line.isSelected ?? true,
  };
  const next = line.id
    ? existing.map((l) => (l.id === line.id ? { ...l, ...values } : l))
    : [...existing, values];
  await assertDiscountAllowed(user, mathLines(next));
  if (line.id) {
    if (!existing.some((l) => l.id === line.id))
      throw new NotFoundError("Line");
    await tx
      .update(lineItems)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(lineItems.id, line.id));
    return line.id;
  }
  const [id] = await insertLines(tx, parentType, parentId, [
    {
      ...toLineInput(line),
      isOptional: values.isOptional,
      isSelected: values.isSelected,
    },
  ]);
  return id ?? null;
}

export const saveEstimateLine = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ optionId: uuid, line: LineSchema }),
  audit: "estimate.line_saved",
  async run({ input, user, tx }) {
    const o = await optionWithEstimate(tx, input.optionId);
    await assertEstimateAccess(user, o.estimateId, "write");
    const e = await openEstimateOrThrow(tx, o.estimateId);
    const lineId = await saveLine(
      tx,
      user,
      "estimate_option",
      o.id,
      input.line,
    );
    await tx
      .update(estimates)
      .set({ updatedAt: new Date() })
      .where(eq(estimates.id, e.id));
    return { estimateId: e.id, jobId: e.jobId, lineId };
  },
  auditEntity: ({ data }) => ({ type: "estimate", id: data.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

export const deleteEstimateLine = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ optionId: uuid, lineId: uuid }),
  audit: "estimate.line_removed",
  async run({ input, user, tx }) {
    const o = await optionWithEstimate(tx, input.optionId);
    await assertEstimateAccess(user, o.estimateId, "write");
    const e = await openEstimateOrThrow(tx, o.estimateId);
    const rows = await tx
      .delete(lineItems)
      .where(
        and(
          eq(lineItems.id, input.lineId),
          eq(lineItems.parentType, "estimate_option"),
          eq(lineItems.parentId, o.id),
        ),
      )
      .returning({ id: lineItems.id });
    if (rows.length === 0) throw new NotFoundError("Line");
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ data }) => ({ type: "estimate", id: data.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

// ------------------------------------------------------------------ send / sign / decide

const SendChannel = z.enum(["customer_preferred", "sms", "email", "link"]);

export const sendEstimate = action({
  perm: "estimates.send",
  feature: F,
  input: z.object({ estimateId: uuid, channel: SendChannel }),
  audit: "estimate.sent",
  async run({ input, user, tx, actor }) {
    await assertEstimateAccess(user, input.estimateId, "read");
    const e = await openEstimateOrThrow(tx, input.estimateId);
    const loaded = await loadEstimate(e.id, tx);
    if (!loaded || loaded.options.every((o) => o.lines.length === 0))
      throw new ValidationError({ lines: ["Add at least one item first."] });
    const url = await mintEstimateLink(tx, e);
    let status: string = "link";
    if (input.channel !== "link") {
      const res = await enqueueMessage(
        tx,
        {
          templateKey: "estimate.sent",
          channel: input.channel,
          purpose: "transactional",
          audience: { type: "customer", customerId: e.customerId },
          entity: { type: "estimate", id: e.id },
          jobId: e.jobId,
          vars: {
            "estimate.link": url,
            "estimate.number": e.number,
            "estimate.total": formatMoney(loaded.headlineCents),
            link: url,
          },
        },
        actor,
      );
      status = res.status;
    }
    await markEstimateSent(tx, e, input.channel, actor);
    return { estimateId: e.id, jobId: e.jobId, url, status };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

const SignFields = {
  signerName: z.string().trim().min(2, "Type the full name.").max(200),
  esignConsent: z.literal(true),
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
};

const deviceDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * "Present to customer": the customer's own /e/ page on this device, full screen
 * (present mode). Mints or reuses a short-lived link; nothing is sent.
 */
export const presentEstimate = action({
  perm: "estimates.send",
  feature: F,
  input: z.object({ estimateId: uuid }),
  audit: "estimate.presented",
  async run({ input, user, tx }) {
    await assertEstimateAccess(user, input.estimateId, "read");
    const e = await openEstimateOrThrow(tx, input.estimateId);
    const loaded = await loadEstimate(e.id, tx);
    if (!loaded || loaded.options.every((o) => o.lines.length === 0))
      throw new ValidationError({ lines: ["Add at least one item first."] });
    const url = await mintEstimatePresentLink(tx, e);
    return { estimateId: e.id, href: `${new URL(url).pathname}?present=1` };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
});

/** "Sign on this device": the customer signs on the tech's phone (S15, in person). */
export const signEstimateInPerson = action({
  perm: "estimates.send",
  feature: F,
  input: z.object({
    estimateId: uuid,
    optionId: uuid,
    addonIds: z.array(uuid).max(50).default([]),
    ...SignFields,
  }),
  audit: "estimate.approved",
  async run({ input, user, tx, actor }) {
    await assertEstimateAccess(user, input.estimateId, "read");
    const r = await approveEstimateTx(
      tx,
      {
        estimateId: input.estimateId,
        optionId: input.optionId,
        addonIds: input.addonIds,
        sign: {
          signerName: input.signerName,
          signatureMediaId: input.signatureMediaId,
          channel: "in_person",
          esignConsent: true,
          geo: input.geo ?? null,
          deviceTs: deviceDate(input.deviceTs),
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
      },
      actor,
    );
    return { ...r, signatureId: r.signatureId ?? "" };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

/** Approve on behalf (verbal): logged as channel "verbal" with the note; raises risk (B4). */
export const approveEstimateVerbal = action({
  perm: "estimates.approve_on_behalf",
  feature: F,
  input: z.object({
    estimateId: uuid,
    optionId: uuid,
    addonIds: zf.array(uuid).pipe(z.array(uuid).max(50)),
    signerName: z.string().trim().min(2, "Who approved?").max(200),
    note: z.string().trim().min(5, "Say how and when they approved.").max(1000),
  }),
  audit: "estimate.approved_verbal",
  async run({ input, user, tx, actor }) {
    await assertEstimateAccess(user, input.estimateId, "read");
    const r = await approveEstimateTx(
      tx,
      {
        estimateId: input.estimateId,
        optionId: input.optionId,
        addonIds: input.addonIds,
        sign: {
          signerName: input.signerName,
          signatureMediaId: null,
          channel: "verbal",
          esignConsent: false,
          consentText: `Verbal approval recorded by ${user.name}: ${input.note}`,
          signerUserId: null,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
      },
      actor,
    );
    return r;
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

export const declineEstimate = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    estimateId: uuid,
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  audit: "estimate.declined",
  async run({ input, user, tx, actor }) {
    const e = await assertEstimateAccess(user, input.estimateId, "write");
    await declineEstimateTx(tx, e.id, input.reason ?? null, actor);
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

/**
 * Re-open a declined, expired or replaced estimate as a fresh window (new expiry).
 * Approving a reopened one replaces the job's invoice lines like any approval.
 */
export const reopenEstimate = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ estimateId: uuid }),
  audit: "estimate.reopened",
  async run({ input, user, tx, activity }) {
    const e = await assertEstimateAccess(user, input.estimateId, "write");
    if (!["declined", "expired", "superseded"].includes(e.status))
      throw new ConflictError(
        "estimate_open",
        "Only declined, expired or replaced estimates can be reopened.",
      );
    const days = (await getSettings()).estimates.expiry_days;
    await tx
      .update(estimates)
      .set({
        status: e.sentAt ? "sent" : "draft",
        declinedAt: null,
        declineReason: null,
        expiresAt: new Date(Date.now() + days * 86_400_000),
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, e.id));
    await activity({
      entity: { type: "estimate", id: e.id },
      customerId: e.customerId,
      jobId: e.jobId,
      kind: "estimate.reopened",
      summary: `Estimate ${e.number} reopened`,
    });
    return { estimateId: e.id, jobId: e.jobId };
  },
  auditEntity: ({ input }) => ({ type: "estimate", id: input.estimateId }),
  revalidate: ({ data }) => estPaths(data.estimateId, data.jobId),
});

// ------------------------------------------------------------------ change orders

async function openCoOrThrow(tx: Tx, coId: string) {
  const [co] = await tx
    .select()
    .from(changeOrders)
    .where(eq(changeOrders.id, coId))
    .limit(1);
  if (!co) throw new NotFoundError("Change order");
  if (co.status !== "draft" && co.status !== "sent")
    throw new ConflictError("co_closed", `${co.number} is ${co.status}.`);
  return co;
}

export const createChangeOrder = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    jobId: uuid,
    reason: z.string().trim().min(3, "Say what changed.").max(500),
  }),
  audit: "change_order.created",
  async run({ input, user, tx, actor }) {
    await assertJobAccess(user, input.jobId, "read");
    const r = await createChangeOrderTx(tx, input, actor);
    return { ...r, jobId: input.jobId };
  },
  auditEntity: ({ data }) => ({ type: "change_order", id: data.changeOrderId }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const updateChangeOrder = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    changeOrderId: uuid,
    reason: z.string().trim().min(3, "Say what changed.").max(500),
  }),
  audit: "change_order.updated",
  async run({ input, user, tx }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "write");
    const co = await openCoOrThrow(tx, input.changeOrderId);
    await tx
      .update(changeOrders)
      .set({ reason: input.reason, updatedAt: new Date() })
      .where(eq(changeOrders.id, co.id));
    return { changeOrderId: co.id, jobId: co.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const saveChangeOrderLine = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ changeOrderId: uuid, line: LineSchema }),
  audit: "change_order.line_saved",
  async run({ input, user, tx }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "write");
    const co = await openCoOrThrow(tx, input.changeOrderId);
    const lineId = await saveLine(tx, user, "change_order", co.id, input.line);
    await recomputeChangeOrder(tx, co.id);
    return { changeOrderId: co.id, jobId: co.jobId, lineId };
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const deleteChangeOrderLine = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({ changeOrderId: uuid, lineId: uuid }),
  audit: "change_order.line_removed",
  async run({ input, user, tx }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "write");
    const co = await openCoOrThrow(tx, input.changeOrderId);
    const rows = await tx
      .delete(lineItems)
      .where(
        and(
          eq(lineItems.id, input.lineId),
          eq(lineItems.parentType, "change_order"),
          eq(lineItems.parentId, co.id),
        ),
      )
      .returning({ id: lineItems.id });
    if (rows.length === 0) throw new NotFoundError("Line");
    await recomputeChangeOrder(tx, co.id);
    return { changeOrderId: co.id, jobId: co.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const sendChangeOrder = action({
  perm: "estimates.send",
  feature: F,
  input: z.object({ changeOrderId: uuid, channel: SendChannel }),
  audit: "change_order.sent",
  async run({ input, user, tx, actor, activity }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "read");
    const co = await openCoOrThrow(tx, input.changeOrderId);
    const loaded = await loadChangeOrder(co.id, tx);
    if (!loaded || loaded.lines.length === 0)
      throw new ValidationError({ lines: ["Add at least one item first."] });
    const url = await mintEstimateLink(
      tx,
      {
        id: co.id,
        customerId: loaded.customer.id,
        jobId: co.jobId,
        expiresAt: null,
      },
      "change_order",
    );
    let status: string = "link";
    if (input.channel !== "link") {
      const res = await enqueueMessage(
        tx,
        {
          templateKey: "change_order.sent",
          channel: input.channel,
          purpose: "transactional",
          audience: { type: "customer", customerId: loaded.customer.id },
          entity: { type: "change_order", id: co.id },
          jobId: co.jobId,
          vars: {
            "change_order.link": url,
            "change_order.number": co.number,
            "change_order.total": formatMoney(loaded.totals.totalCents),
            link: url,
          },
        },
        actor,
      );
      status = res.status;
    }
    if (co.status === "draft")
      await tx
        .update(changeOrders)
        .set({ status: "sent", updatedAt: new Date() })
        .where(eq(changeOrders.id, co.id));
    await activity({
      entity: { type: "change_order", id: co.id },
      customerId: loaded.customer.id,
      jobId: co.jobId,
      kind: "change_order.sent",
      summary: `Change order ${co.number} sent (${input.channel.replace("_", " ")})`,
    });
    return { changeOrderId: co.id, jobId: co.jobId, url, status };
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const signChangeOrderInPerson = action({
  perm: "estimates.send",
  feature: F,
  input: z.object({ changeOrderId: uuid, ...SignFields }),
  audit: "change_order.approved",
  async run({ input, user, tx, actor }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "read");
    return approveChangeOrderTx(
      tx,
      {
        changeOrderId: input.changeOrderId,
        sign: {
          signerName: input.signerName,
          signatureMediaId: input.signatureMediaId,
          channel: "in_person",
          esignConsent: true,
          geo: input.geo ?? null,
          deviceTs: deviceDate(input.deviceTs),
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
        },
      },
      actor,
    );
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const approveChangeOrderVerbal = action({
  perm: "estimates.approve_on_behalf",
  feature: F,
  input: z.object({
    changeOrderId: uuid,
    signerName: z.string().trim().min(2, "Who approved?").max(200),
    note: z.string().trim().min(5, "Say how and when they approved.").max(1000),
  }),
  audit: "change_order.approved_verbal",
  async run({ input, user, tx, actor }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "read");
    return approveChangeOrderTx(
      tx,
      {
        changeOrderId: input.changeOrderId,
        sign: {
          signerName: input.signerName,
          signatureMediaId: null,
          channel: "verbal",
          esignConsent: false,
          consentText: `Verbal approval recorded by ${user.name}: ${input.note}`,
        },
      },
      actor,
    );
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});

export const declineChangeOrder = action({
  perm: "estimates.create",
  feature: F,
  input: z.object({
    changeOrderId: uuid,
    reason: z.string().trim().max(500).nullable().optional(),
  }),
  audit: "change_order.declined",
  async run({ input, user, tx, actor }) {
    await assertChangeOrderAccess(user, input.changeOrderId, "write");
    const r = await declineChangeOrderTx(
      tx,
      input.changeOrderId,
      input.reason ?? null,
      actor,
    );
    return { changeOrderId: input.changeOrderId, jobId: r.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "change_order",
    id: input.changeOrderId,
  }),
  revalidate: ({ data }) => coPaths(data.changeOrderId, data.jobId),
});
