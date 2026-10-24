"use server";

import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  inventoryLevels,
  invoices,
  lineItems,
  partPurchases,
  pricebookItems,
  stockLocations,
  tools,
  vehicles,
} from "@/db/schema";
import { addJobLine, removeJobLine } from "@/features/invoices/api";
import { assertJobAccess } from "@/features/jobs/api";
import { mediaIdsForClientIds } from "@/features/media/api";
import {
  ensureDepositRequest,
  markSpecialOrderPo,
} from "@/features/payments/api";
import { recomputeJobFinancials } from "@/features/payroll/server/financials";
import {
  companyTz,
  settingsOf,
  todayKey,
} from "@/features/payroll/server/util";
import { action, zf } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { getSettings, updateSettings } from "@/lib/settings";
import {
  decrementForJob,
  ensureLocations,
  locationForUser,
  recordCount,
  recordMove,
  requestRestock,
  setPar,
} from "./server/inventory";
import { markupPrice } from "./server/markup";
import { attachReceipt, createPurchase } from "./server/purchases";

// Parts & inventory mutations (SPEC M15). Every write: action() → perm → flag → zod →
// one transaction (domain write + events + audit + activity) → revalidate.

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const CATEGORIES = [
  "part",
  "fuel",
  "vehicle",
  "tool",
  "supplies",
  "other",
] as const;

/**
 * Media id from an online upload, or from an offline upload's client id. Whether the
 * file may be used as this user's receipt is checked by createPurchase/attachReceipt
 * (assertReceiptMedia: own upload, receipt kind, not already claimed).
 */
async function resolveMedia(
  mediaId: string | null | undefined,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (mediaId) return mediaId;
  if (!clientId) return null;
  return (await mediaIdsForClientIds([clientId]))[clientId] ?? null;
}

const jobPaths = (jobId: string) => [
  `/jobs/${jobId}`,
  "/today",
  "/today/finish",
  "/parts",
];

// ------------------------------------------------------------------ add part to job

const AddPartInput = z
  .object({
    jobId: uuid,
    source: z.enum([
      "company_stock",
      "company_po",
      "company_card",
      "tech_purchased",
    ]),
    pricebookItemId: uuid.nullish(),
    name: z.string().trim().min(1, "Name the part.").max(200),
    description: z.string().trim().max(1000).nullish(),
    qty: z.coerce.number().positive("Enter a quantity.").max(9999),
    /** Per-unit cost (stock/PO); tech-paid and card use the receipt total ÷ qty. */
    unitCostCents: z.number().int().min(0).nullish(),
    /** Per-unit price to the customer (default: price book, else the markup matrix). */
    unitPriceCents: z.number().int().min(0).nullish(),
    /** Receipt total for tech_purchased / company_card. */
    receiptTotalCents: z.number().int().positive().nullish(),
    vendor: z.string().trim().max(120).nullish(),
    purchasedOn: day.nullish(),
    receiptMediaId: uuid.nullish(),
    /** Offline: the receipt upload's client id (resolved to a media id server-side). */
    receiptClientId: uuid.nullish(),
    taxable: z.boolean().optional(),
    specialOrder: z.boolean().optional(),
    warrantyDays: z.number().int().min(0).nullish(),
    manufacturerWarrantyMonths: z.number().int().min(0).nullish(),
    serial: z.string().trim().max(80).nullish(),
    clientId: uuid.optional(),
    clientTs: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      (v.source === "tech_purchased" || v.source === "company_card") &&
      !v.receiptTotalCents
    )
      ctx.addIssue({
        code: "custom",
        path: ["receiptTotalCents"],
        message: "Enter what you paid.",
      });
    if (v.source === "company_card" && !v.receiptMediaId && !v.receiptClientId)
      ctx.addIssue({
        code: "custom",
        path: ["receiptMediaId"],
        message: "Company card purchases need a receipt photo.",
      });
  });

export const addPartToJob = action({
  perm: "parts.add_to_job",
  feature: "parts",
  input: AddPartInput,
  audit: "parts.added_to_job",
  async run({ input, user, tx, actor }) {
    const job = await assertJobAccess(user, input.jobId, "write");
    const receiptMediaId = await resolveMedia(
      input.receiptMediaId,
      input.receiptClientId,
    );
    const tz = await companyTz(tx);
    const today = todayKey(tz);
    let item: typeof pricebookItems.$inferSelect | undefined;
    if (input.pricebookItemId) {
      [item] = await tx
        .select()
        .from(pricebookItems)
        .where(eq(pricebookItems.id, input.pricebookItemId))
        .limit(1);
      if (!item) throw new NotFoundError("Price book item");
    }
    const paidOnReceipt =
      input.source === "tech_purchased" || input.source === "company_card";
    const unitCost = paidOnReceipt
      ? Math.round((input.receiptTotalCents ?? 0) / input.qty)
      : (input.unitCostCents ??
        item?.avgCostCents ??
        item?.unitCostCents ??
        null);
    const unitPrice =
      input.unitPriceCents ??
      item?.unitPriceCents ??
      (unitCost != null ? await markupPrice(tx, unitCost) : null);
    if (unitPrice == null)
      throw new ValidationError({
        unitPriceCents: ["Enter the price to charge."],
      });

    let partPurchaseId: string | null = null;
    let status: "pending" | "approved" | null = null;
    if (paidOnReceipt) {
      const r = await createPurchase(
        tx,
        {
          paidBy: input.source === "tech_purchased" ? "tech" : "company",
          instrument:
            input.source === "tech_purchased" ? "personal" : "company_card",
          purchaserUserId: user.id,
          category: "part",
          jobId: input.jobId,
          vendor: input.vendor ?? null,
          purchasedOn: input.purchasedOn ?? today,
          totalCents: input.receiptTotalCents ?? 0,
          receiptMediaId,
          notes: `${input.qty} × ${input.name}`,
          clientId: input.clientId ?? null,
        },
        actor,
        { anyUploader: user.perms.has("parts.approve_reimbursement") },
      );
      partPurchaseId = r.partPurchaseId;
      status = r.status;
    }
    const { lineItemId } = await addJobLine(
      tx,
      input.jobId,
      {
        type: item?.kind === "material" ? "material" : "part",
        pricebookItemId: item?.id ?? null,
        name: input.name,
        description: input.description ?? item?.description ?? null,
        qty: input.qty,
        unitPriceCents: unitPrice,
        unitCostCents: unitCost,
        taxable: input.taxable ?? item?.taxable ?? true,
        partSource: input.source,
        partPurchaseId,
        warrantyDays: input.warrantyDays ?? item?.warrantyDays ?? null,
        manufacturerWarrantyMonths:
          input.manufacturerWarrantyMonths ??
          item?.manufacturerWarrantyMonths ??
          null,
        serial: input.serial ?? null,
        // An approved estimate keeps parts lines (never bills them twice).
        sourceType: "part",
      },
      actor,
    );
    let decremented = false;
    if (input.source === "company_stock" && item) {
      const primary = job.assignees.find((a) => a.role === "primary")?.userId;
      const holder = job.viewerIsAssignee ? user.id : (primary ?? user.id);
      decremented = await decrementForJob(
        tx,
        {
          userId: holder,
          pricebookItemId: item.id,
          qty: input.qty,
          jobId: input.jobId,
          lineItemId,
        },
        actor,
      );
    }
    let depositRequired = false;
    if (input.specialOrder || item?.isSpecialOrder) {
      const dep = await ensureDepositRequest(
        tx,
        { jobId: input.jobId, context: "special_order" },
        actor,
      );
      depositRequired =
        !!dep && dep.status !== "paid" && dep.status !== "applied";
      await markSpecialOrderPo(tx, input.jobId, new Date(), actor);
    }
    if (job.status === "completed" || job.status === "closed")
      await recomputeJobFinancials(tx, input.jobId, actor, "part_added");
    return { lineItemId, partPurchaseId, status, decremented, depositRequired };
  },
  auditEntity: ({ input }) => ({ type: "job", id: input.jobId }),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

export const removePartLine = action({
  perm: "parts.add_to_job",
  feature: "parts",
  input: z.object({ jobId: uuid, lineItemId: uuid }),
  audit: "parts.removed_from_job",
  async run({ input, user, tx, actor }) {
    const job = await assertJobAccess(user, input.jobId, "write");
    // The line must be a part on THIS job's invoice: the job check above says
    // nothing about a line id from another tech's job (QA T5-01).
    const [l] = await tx
      .select({ id: lineItems.id })
      .from(lineItems)
      .innerJoin(invoices, eq(invoices.id, lineItems.parentId))
      .where(
        and(
          eq(lineItems.id, input.lineItemId),
          eq(lineItems.parentType, "invoice"),
          eq(invoices.jobId, input.jobId),
          inArray(lineItems.type, ["part", "material"]),
        ),
      )
      .limit(1);
    if (!l) throw new NotFoundError("Part");
    // Put the stock back first (the moves point at the line), then drop the line.
    const { returnFromJob } = await import("./server/inventory");
    await returnFromJob(tx, input.lineItemId, actor);
    await removeJobLine(tx, input.lineItemId, actor);
    if (job.status === "completed" || job.status === "closed")
      await recomputeJobFinancials(tx, input.jobId, actor, "part_removed");
    return { lineItemId: input.lineItemId };
  },
  auditEntity: ({ input }) => ({ type: "job", id: input.jobId }),
  revalidate: ({ input }) => jobPaths(input.jobId),
});

// ------------------------------------------------------------------ receipts

const ReceiptInput = z.object({
  paidBy: z.enum(["tech", "company_card"]).default("tech"),
  category: z.enum(CATEGORIES).default("part"),
  jobId: uuid.nullish(),
  vehicleId: uuid.nullish(),
  toolId: uuid.nullish(),
  vendor: z.string().trim().max(120).nullish(),
  purchasedOn: day,
  subtotalCents: z.number().int().min(0).nullish(),
  taxCents: z.number().int().min(0).nullish(),
  totalCents: z.number().int().positive("Enter the receipt total."),
  receiptMediaId: uuid.nullish(),
  receiptClientId: uuid.nullish(),
  notes: z.string().trim().max(500).nullish(),
  clientId: uuid.optional(),
  clientTs: z.string().optional(),
});

/** New receipt from /parts (job or non-job: fuel, vehicle, tool, supplies). Offline-capable. */
export const submitReceipt = action({
  perm: "parts.submit_receipt",
  feature: "parts",
  input: ReceiptInput,
  audit: "parts.receipt_submitted",
  async run({ input, user, tx, actor }) {
    if (input.jobId) await assertJobAccess(user, input.jobId, "read");
    // A vehicle or tool receipt is the tech's own truck or a tool in their custody
    // unless they can see the whole fleet / tool room (QA T5-16).
    if (input.vehicleId && !user.perms.has("vehicles.view_all")) {
      const [v] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.id, input.vehicleId),
            eq(vehicles.assignedUserId, user.id),
          ),
        )
        .limit(1);
      if (!v) throw new ForbiddenError("That vehicle isn't assigned to you.");
    }
    if (input.toolId && !user.perms.has("tools.view_all")) {
      const [t] = await tx
        .select({ id: tools.id })
        .from(tools)
        .where(
          and(
            eq(tools.id, input.toolId),
            or(
              eq(tools.currentUserId, user.id),
              eq(tools.ownerUserId, user.id),
            ),
          ),
        )
        .limit(1);
      if (!t) throw new ForbiddenError("That tool isn't checked out to you.");
    }
    const receiptMediaId = await resolveMedia(
      input.receiptMediaId,
      input.receiptClientId,
    );
    if (input.paidBy === "company_card" && !receiptMediaId)
      throw new ValidationError({
        receiptMediaId: ["Company card purchases need a receipt photo."],
      });
    const r = await createPurchase(
      tx,
      {
        paidBy: input.paidBy === "tech" ? "tech" : "company",
        instrument: input.paidBy === "tech" ? "personal" : "company_card",
        purchaserUserId: user.id,
        category: input.category,
        jobId: input.jobId ?? null,
        vehicleId: input.vehicleId ?? null,
        toolId: input.toolId ?? null,
        vendor: input.vendor ?? null,
        purchasedOn: input.purchasedOn,
        subtotalCents: input.subtotalCents ?? null,
        taxCents: input.taxCents ?? null,
        totalCents: input.totalCents,
        receiptMediaId,
        notes: input.notes ?? null,
        clientId: input.clientId ?? null,
      },
      actor,
      { anyUploader: user.perms.has("parts.approve_reimbursement") },
    );
    return r;
  },
  auditEntity: ({ data }) => ({
    type: "part_purchase",
    id: data.partPurchaseId,
  }),
  revalidate: ({ input }) => [
    "/parts",
    "/pay",
    "/approvals",
    ...(input.jobId ? jobPaths(input.jobId) : []),
  ],
});

/** Add the missing receipt photo to a purchase (S45 "Add receipt", /parts). */
export const addReceiptPhoto = action({
  perm: "parts.submit_receipt",
  feature: "parts",
  input: z.object({
    partPurchaseId: uuid,
    mediaId: uuid,
    clientId: uuid.optional(),
  }),
  audit: "parts.receipt_added",
  async run({ input, user, tx, actor }) {
    const [p] = await tx
      .select({
        purchaser: partPurchases.purchaserUserId,
        jobId: partPurchases.jobId,
      })
      .from(partPurchases)
      .where(eq(partPurchases.id, input.partPurchaseId))
      .limit(1);
    if (!p) throw new NotFoundError("Receipt");
    if (
      p.purchaser !== user.id &&
      !user.perms.has("parts.approve_reimbursement")
    )
      throw new ForbiddenError();
    const r = await attachReceipt(
      tx,
      input.partPurchaseId,
      input.mediaId,
      actor,
      { anyUploader: user.perms.has("parts.approve_reimbursement") },
    );
    return { ...r, jobId: p.jobId };
  },
  auditEntity: ({ input }) => ({
    type: "part_purchase",
    id: input.partPurchaseId,
  }),
  revalidate: ({ data }) => [
    "/parts",
    "/today/finish",
    "/approvals",
    ...(data.jobId ? [`/jobs/${data.jobId}`] : []),
  ],
});

// ------------------------------------------------------------------ inventory

export const moveStock = action({
  perm: "inventory.manage",
  feature: ["parts", "inventory"],
  input: z.object({
    kind: z.enum(["receive", "transfer", "adjust", "return"]),
    pricebookItemId: uuid,
    qty: z.coerce.number().refine((n) => n !== 0, "Enter a quantity."),
    fromLocationId: uuid.nullish(),
    toLocationId: uuid.nullish(),
    unitCostCents: z.number().int().min(0).nullish(),
    note: z.string().trim().max(300).nullish(),
  }),
  audit: "inventory.moved",
  async run({ input, tx, actor }) {
    return recordMove(tx, input, actor);
  },
  revalidate: () => ["/inventory"],
});

export const setParLevel = action({
  perm: "inventory.manage",
  feature: ["parts", "inventory"],
  input: z.object({
    locationId: uuid,
    pricebookItemId: uuid,
    minQty: z.number().min(0).nullable(),
    maxQty: z.number().min(0).nullable(),
  }),
  async run({ input, tx, actor }) {
    await setPar(tx, input, actor);
    return { ok: true };
  },
  revalidate: () => ["/inventory"],
});

export const submitCount = action({
  perm: "inventory.manage",
  feature: ["parts", "inventory"],
  input: z.object({
    locationId: uuid,
    counts: z
      .array(z.object({ pricebookItemId: uuid, counted: z.number().min(0) }))
      .min(1),
  }),
  audit: "inventory.counted",
  async run({ input, tx, actor }) {
    return recordCount(tx, input.locationId, input.counts, actor);
  },
  auditEntity: ({ input }) => ({
    type: "stock_location",
    id: input.locationId,
  }),
  revalidate: () => ["/inventory"],
});

export const requestTruckRestock = action({
  perm: "inventory.request_restock",
  feature: ["parts", "inventory"],
  input: z.object({
    locationId: uuid.nullish(),
    note: z.string().trim().max(300).nullish(),
  }),
  audit: "inventory.restock_requested",
  async run({ input, user, tx, actor }) {
    let locationId = input.locationId ?? null;
    if (!locationId)
      locationId = (await locationForUser(tx, user.id))?.id ?? null;
    if (!locationId)
      throw new ConflictError(
        "no_truck",
        "You don't have a vehicle assigned, so there's no truck stock.",
      );
    if (!user.perms.has("inventory.manage")) {
      const mine = await locationForUser(tx, user.id);
      if (mine?.id !== locationId) throw new ForbiddenError();
    }
    return requestRestock(tx, locationId, actor, input.note);
  },
  revalidate: () => ["/inventory", "/tasks"],
});

export const syncLocations = action({
  perm: "inventory.manage",
  feature: ["parts", "inventory"],
  input: z.object({}),
  async run({ tx }) {
    await ensureLocations(tx);
    return { ok: true };
  },
  revalidate: () => ["/inventory"],
});

export const renameLocation = action({
  perm: "inventory.manage",
  feature: ["parts", "inventory"],
  input: z.object({ locationId: uuid, name: z.string().trim().min(1).max(60) }),
  audit: "inventory.location_renamed",
  async run({ input, tx }) {
    await tx
      .update(stockLocations)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(stockLocations.id, input.locationId));
    return { ok: true };
  },
  auditEntity: ({ input }) => ({
    type: "stock_location",
    id: input.locationId,
  }),
  revalidate: () => ["/inventory"],
});

// ------------------------------------------------------------------ settings

export const savePartsSettings = action({
  perm: "settings.manage",
  input: z.object({
    receiptRequiredOverCents: z.number().int().min(0),
    autoApproveUnderCents: z.number().int().min(0),
    aiMatchToleranceCents: z.number().int().min(0).max(100000),
    receiptMaxAgeDays: z.coerce.number().int().min(0).max(365),
    staleReceiptDays: z.coerce.number().int().min(1).max(3650),
    warrantyClaimDays: z.coerce.number().int().min(1).max(365),
    cycleCountDay: z.coerce.number().int().min(1).max(28),
    decrementOnUse: zf.checkbox(),
    restockAssigneeUserId: uuid.nullish(),
  }),
  async run({ input, tx, actor }) {
    const s = await settingsOf(tx);
    await updateSettings(
      tx,
      {
        parts: {
          receipt_required_over_cents: input.receiptRequiredOverCents,
          ai_match_tolerance_cents: input.aiMatchToleranceCents,
          receipt_max_age_days: input.receiptMaxAgeDays,
          stale_receipt_days: input.staleReceiptDays,
          warranty_claim_days: input.warrantyClaimDays,
        },
        inventory: {
          cycle_count_day: input.cycleCountDay,
          decrement_on_use: input.decrementOnUse,
          restock_assignee_user_id: input.restockAssigneeUserId ?? null,
        },
        limits: {
          ...s.limits,
          auto_approve_under_cents: input.autoApproveUnderCents,
        },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/parts"],
});

// ------------------------------------------------------------------ reads for the AddPart sheet

/** Read-only context for the AddPart sheet (truck stock, markup, receipt rule). Not a mutation. */
export async function addPartContext(jobId: string): Promise<{
  inventoryOn: boolean;
  locationName: string | null;
  stock: {
    itemId: string;
    name: string;
    sku: string | null;
    onHand: number;
    priceCents: number;
    costCents: number | null;
    taxable: boolean;
    kind: string;
  }[];
  markupTiers: { lt: number | null; mult: number }[];
  receiptRequiredOverCents: number;
  invoiceIssued: boolean;
}> {
  const user = await requireUser("parts.add_to_job");
  await assertJobAccess(user, jobId, "read");
  const s = await getSettings();
  const loc = s.features.inventory ? await locationForUser(db, user.id) : null;
  const stock = loc
    ? await db
        .select({
          itemId: pricebookItems.id,
          name: pricebookItems.name,
          sku: pricebookItems.sku,
          onHand: inventoryLevels.onHand,
          priceCents: pricebookItems.unitPriceCents,
          costCents: pricebookItems.unitCostCents,
          avg: pricebookItems.avgCostCents,
          taxable: pricebookItems.taxable,
          kind: pricebookItems.kind,
        })
        .from(inventoryLevels)
        .innerJoin(
          pricebookItems,
          eq(pricebookItems.id, inventoryLevels.pricebookItemId),
        )
        .where(
          and(
            eq(inventoryLevels.locationId, loc.id),
            sql`${inventoryLevels.onHand} > 0`,
          ),
        )
        .orderBy(asc(pricebookItems.name))
    : [];
  const [inv] = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId), sql`${invoices.status} <> 'void'`))
    .orderBy(desc(invoices.createdAt))
    .limit(1);
  return {
    inventoryOn: !!s.features.inventory,
    locationName: loc?.name ?? null,
    stock: stock.map((r) => ({
      itemId: r.itemId,
      name: r.name,
      sku: r.sku,
      onHand: Number(r.onHand),
      priceCents: r.priceCents ?? 0,
      costCents: r.avg ?? r.costCents,
      taxable: r.taxable,
      kind: r.kind,
    })),
    markupTiers: s.parts.markup_tiers,
    receiptRequiredOverCents: s.parts.receipt_required_over_cents,
    invoiceIssued: !!inv && inv.status !== "draft",
  };
}
