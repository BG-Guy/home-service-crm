"use server";

import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { aiProviderName, queueAiTask } from "@/adapters/ai";
import { db, type Tx } from "@/db";
import {
  aiTasks,
  company,
  media,
  toolAssignments,
  toolAuditItems,
  toolAudits,
  toolIncidents,
  toolKits,
  toolMaintenanceLogs,
  tools,
  users,
} from "@/db/schema";
import { notify } from "@/features/notify/api";
import { createPartPurchase } from "@/features/parts/api";
import { postLedgerEntry } from "@/features/payroll/api";
import { validateCustomValues } from "@/features/settings/api";
import { captureSignature, hasSignature } from "@/features/signatures/api";
import type { SignatureSubmit } from "@/features/signatures/contracts";
import { action } from "@/lib/action";
import { diffObjects } from "@/lib/audit";
import { requireAnyPerm } from "@/lib/auth/current";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  getCompanyTimezone,
  getSettings,
  updateSettings,
} from "@/lib/settings";
import { dateKey } from "@/lib/time";
import {
  closeOpenAssignment,
  loadTool,
  scheduleAuditFor,
  toolEntity,
} from "./engine";
import {
  assetTag,
  BLOCK_LABEL,
  checkoutBlock,
  deductionAllowed,
  nextMaintenanceOn,
} from "./rules";

// Tool mutations (SPEC M18). All through action(): perm → `tools` flag → zod →
// clientId idempotency → one transaction (write + events + audit + activity).

const uuid = z.string().uuid();
// "" (an empty <select>) means none, like optText.
const optUuid = z.preprocess(
  (v) => (v === "" ? null : v),
  z.string().uuid().nullish(),
);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const optDay = z.preprocess((v) => (v === "" ? null : v), dayKey.nullish());
const optText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullish(),
  );
const optInt = (min = 0, max = 100_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(min).max(max).nullable(),
  );
const condition = z.enum(["new", "good", "fair", "poor"]);

const toolPaths = (id?: string) => [
  "/tools",
  "/today",
  ...(id ? [`/tools/${id}`] : []),
];

async function companyToday(): Promise<string> {
  return dateKey(new Date(), await getCompanyTimezone());
}

/**
 * Photos a user uploaded for an entity (QA2 NEW-1: only the uploader's own, so a
 * tech can't fill a tool check or a tool record with someone else's pictures).
 */
async function photosOf(
  tx: Tx,
  entityType: string,
  entityId: string,
  uploaderId: string,
) {
  const rows = await tx
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.entityType, entityType),
        eq(media.entityId, entityId),
        eq(media.uploaderId, uploaderId),
        isNull(media.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/** A live media id this user uploaded, else null. */
async function verifyMedia(
  tx: Tx,
  id: string | null | undefined,
  uploaderId: string,
) {
  if (!id) return null;
  const [m] = await tx
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.id, id),
        eq(media.uploaderId, uploaderId),
        isNull(media.deletedAt),
      ),
    )
    .limit(1);
  return m?.id ?? null;
}

// ------------------------------------------------------------------ tools

const ToolInput = z.object({
  id: uuid,
  isNew: z.preprocess((v) => v === true || v === "true", z.boolean()),
  name: z.string().trim().min(1, "Name the tool.").max(120),
  category: optText(60),
  brand: optText(60),
  model: optText(80),
  serial: optText(80),
  purchaseDate: optDay,
  purchaseCostCents: optInt(),
  replacementCostCents: optInt(),
  owner: z.enum(["company", "tech_owned"]).default("company"),
  ownerUserId: optUuid,
  condition: condition.default("good"),
  calibrationDueOn: optDay,
  maintenanceIntervalDays: optInt(0, 3650),
  maintenanceTask: optText(80),
  lastMaintainedOn: optDay,
  notes: optText(2000),
  custom: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Create / edit a tool. Photos are required on create (uploaded against the planned
 * id). Without `tools.manage`, a user may only register their own tech-owned tools.
 */
export const saveTool = action({
  anyPerm: ["tools.manage", "tools.view_own"],
  feature: "tools",
  input: ToolInput,
  audit: "tool.saved",
  async run({ input, tx, user, activity, audit }) {
    const manage = user.perms.has("tools.manage");
    const custom = await validateCustomValues("tool", input.custom);
    if (!custom.ok)
      throw new ValidationError(
        custom.fieldErrors,
        "Please fix the custom fields.",
      );
    const owner = manage ? input.owner : "tech_owned";
    const ownerUserId =
      owner === "tech_owned"
        ? manage
          ? (input.ownerUserId ?? user.id)
          : user.id
        : null;
    const values = {
      name: input.name,
      category: input.category ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      serial: input.serial ?? null,
      purchaseDate: input.purchaseDate ?? null,
      purchaseCostCents: input.purchaseCostCents,
      replacementCostCents: input.replacementCostCents,
      owner,
      ownerUserId,
      condition: input.condition,
      calibrationDueOn: input.calibrationDueOn ?? null,
      maintenanceIntervalDays: input.maintenanceIntervalDays || null,
      maintenanceTask: input.maintenanceTask ?? null,
      lastMaintainedOn: input.lastMaintainedOn ?? null,
      nextMaintenanceOn: nextMaintenanceOn(
        input.lastMaintainedOn ?? null,
        input.maintenanceIntervalDays,
      ),
      notes: input.notes ?? null,
      custom: custom.values,
    };
    const [existing] = await tx
      .select()
      .from(tools)
      .where(eq(tools.id, input.id))
      .limit(1);
    if (existing && !input.isNew) {
      if (!manage && existing.ownerUserId !== user.id)
        throw new ForbiddenError("You can only edit your own tools.");
      await tx
        .update(tools)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tools.id, existing.id));
      const d = diffObjects(existing, { ...existing, ...values });
      await audit({
        action: "tool.updated",
        entity: toolEntity(existing.id),
        before: d.before,
        after: d.after,
      });
      return { id: existing.id };
    }
    if (existing)
      throw new ConflictError("tool_exists", "That tool already exists.");
    if ((await photosOf(tx, "tool", input.id, user.id)).length === 0)
      throw new ValidationError({
        photo: ["Add at least one photo of the tool."],
      });
    if (!input.maintenanceIntervalDays && input.category) {
      const byCat = (await getSettings()).tools
        .maintenance_interval_days_by_category;
      const d = byCat[input.category];
      if (d) {
        values.maintenanceIntervalDays = d;
        values.nextMaintenanceOn = nextMaintenanceOn(
          values.lastMaintainedOn ?? (await companyToday()),
          d,
        );
      }
    }
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(tools);
    await tx.insert(tools).values({
      id: input.id,
      ...values,
      assetTag: assetTag(Number(n) + 1),
      status: "available",
    });
    await activity({
      entity: toolEntity(input.id),
      kind: "tool.created",
      summary: `Added ${input.name}${owner === "tech_owned" ? " (tech-owned)" : ""}`,
    });
    return { id: input.id };
  },
  auditEntity: ({ data }) => toolEntity(data.id),
  revalidate: ({ data }) => toolPaths(data.id),
});

/** Read a tool nameplate with AI (`tool_label`): brand, model, serial — tech confirms. */
export const readToolLabel = action({
  anyPerm: ["tools.manage", "tools.view_own"],
  feature: "tools",
  input: z.object({ mediaId: uuid, toolId: uuid }),
  async run({ input, tx }) {
    if (aiProviderName() === "none")
      throw new ConflictError("ai_off", "AI assist is off — type the details.");
    const res = await queueAiTask(tx, {
      kind: "tool_label",
      mediaIds: [input.mediaId],
      ref: { module: "tools", entityType: "tool", entityId: input.toolId },
    });
    return { aiTaskId: res.aiTaskId, status: res.status };
  },
});

/** Poll a `tool_label` AI result. */
export async function getToolLabelResult(aiTaskId: string): Promise<{
  status: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  confidence: number | null;
}> {
  await requireAnyPerm(["tools.manage", "tools.view_own"]);
  const none = { brand: null, model: null, serial: null, confidence: null };
  if (!/^[0-9a-f-]{36}$/i.test(aiTaskId)) return { status: "failed", ...none };
  const [t] = await db
    .select({
      status: aiTasks.status,
      output: aiTasks.output,
      kind: aiTasks.kind,
    })
    .from(aiTasks)
    .where(eq(aiTasks.id, aiTaskId))
    .limit(1);
  if (!t || t.kind !== "tool_label") return { status: "failed", ...none };
  const o = (t.output ?? {}) as Partial<typeof none>;
  return {
    status: t.status,
    brand: o.brand ?? null,
    model: o.model ?? null,
    serial: o.serial ?? null,
    confidence: o.confidence ?? null,
  };
}

// ------------------------------------------------------------------ custody

const HandoffInput = z.object({
  toolIds: z.array(uuid).min(1, "Pick at least one tool.").max(100),
  userId: optUuid,
  vehicleId: optUuid,
  condition: condition.default("good"),
  mediaId: optUuid,
});

/** Check out (assign) tools to a tech and/or vehicle. Blocks overdue calibration and in-repair tools. */
export const checkOutTools = action({
  name: "tools.checkOut",
  perm: "tools.manage",
  feature: "tools",
  input: HandoffInput,
  audit: "tool.checked_out",
  async run({ input, tx, user, activity }) {
    if (!input.userId && !input.vehicleId)
      throw new ValidationError({ userId: ["Pick a tech or a vehicle."] });
    const settings = (await getSettings()).tools;
    const photo = await verifyMedia(tx, input.mediaId, user.id);
    if (settings.require_handoff_photo && !photo)
      throw new ValidationError({
        mediaId: ["Take a photo of the tools at handoff."],
      });
    if (input.userId) {
      const [u] = await tx
        .select({
          id: users.id,
          uses: users.usesCompanyTools,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!u || u.status !== "active")
        throw new ValidationError({ userId: ["Pick an active user."] });
      if (!u.uses)
        throw new ValidationError({
          userId: ["This tech doesn’t use company tools (see their profile)."],
        });
    }
    const today = await companyToday();
    const rows = await tx
      .select()
      .from(tools)
      .where(and(inArray(tools.id, input.toolIds), isNull(tools.deletedAt)));
    if (rows.length !== input.toolIds.length) throw new NotFoundError("Tool");
    const blocked = rows
      .map((t) => ({
        t,
        why: checkoutBlock(t, today, {
          blockOnCalibration: settings.block_on_calibration_overdue,
          allowReassign: true,
        }),
      }))
      .filter((x) => x.why);
    if (blocked.length)
      throw new ConflictError(
        "tool_blocked",
        blocked
          .map(
            (b) =>
              `${b.t.name}: ${BLOCK_LABEL[b.why as keyof typeof BLOCK_LABEL]}`,
          )
          .join("; "),
      );
    for (const t of rows) {
      if (t.owner === "tech_owned")
        throw new ConflictError(
          "tech_owned",
          `${t.name} is tech-owned and can't be assigned.`,
        );
      // Reassigning closes the previous custody first (full history).
      await closeOpenAssignment(tx, t.id, {
        condition: t.condition,
        mediaId: null,
      });
      await tx.insert(toolAssignments).values({
        toolId: t.id,
        userId: input.userId ?? null,
        vehicleId: input.vehicleId ?? null,
        outCondition: input.condition,
        outMediaId: photo,
        byUserId: user.id,
      });
      await tx
        .update(tools)
        .set({
          status: "assigned",
          condition: input.condition,
          currentUserId: input.userId ?? null,
          currentVehicleId: input.vehicleId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(tools.id, t.id));
      await activity({
        entity: toolEntity(t.id),
        kind: "tool.checked_out",
        summary: "Checked out",
        data: {
          user_id: input.userId,
          vehicle_id: input.vehicleId,
          condition: input.condition,
        },
      });
    }
    if (input.userId && input.userId !== user.id)
      await notify(tx, {
        to: { userIds: [input.userId] },
        type: "staff.generic",
        title:
          rows.length === 1
            ? `${rows[0]?.name} assigned to you`
            : `${rows.length} tools assigned to you`,
        body: "Open Tools and tap “I have received these tools”.",
        url: "/tools?scope=mine",
      });
    return { count: rows.length };
  },
  revalidate: ({ input }) => [
    ...toolPaths(),
    ...input.toolIds.map((id) => `/tools/${id}`),
  ],
});

/** Check a tool back in (custodian or manager): condition + photo; optional "send to repair". */
export const checkInTool = action({
  name: "tools.checkIn",
  anyPerm: ["tools.manage", "tools.view_own"],
  feature: "tools",
  input: z.object({
    toolId: uuid,
    condition,
    mediaId: optUuid,
    toRepair: z.boolean().default(false),
    note: optText(500),
  }),
  audit: "tool.checked_in",
  async run({ input, tx, user, activity }) {
    const t = await loadTool(tx, input.toolId);
    const manage = user.perms.has("tools.manage");
    if (!manage && t.currentUserId !== user.id)
      throw new ForbiddenError("That tool isn't in your custody.");
    const settings = (await getSettings()).tools;
    const photo = await verifyMedia(tx, input.mediaId, user.id);
    if (settings.require_handoff_photo && !photo)
      throw new ValidationError({
        mediaId: ["Take a photo of the tool at handoff."],
      });
    if (t.status !== "assigned" && t.status !== "in_repair")
      throw new ConflictError("not_assigned", "This tool isn't checked out.");
    await closeOpenAssignment(tx, t.id, {
      condition: input.condition,
      mediaId: photo,
    });
    const status =
      input.toRepair || input.condition === "poor" ? "in_repair" : "available";
    await tx
      .update(tools)
      .set({
        status,
        condition: input.condition,
        currentUserId: null,
        currentVehicleId: null,
        updatedAt: new Date(),
      })
      .where(eq(tools.id, t.id));
    await activity({
      entity: toolEntity(t.id),
      kind: "tool.checked_in",
      summary:
        status === "in_repair"
          ? `Checked in (${input.condition}) → repair`
          : `Checked in (${input.condition})`,
      data: { note: input.note ?? null },
    });
    return { id: t.id, status };
  },
  auditEntity: ({ input }) => toolEntity(input.toolId),
  revalidate: ({ input }) => toolPaths(input.toolId),
});

/** "I have received these tools" — the custodian acknowledges open handoffs. */
export const acknowledgeTools = action({
  name: "tools.acknowledge",
  perm: "tools.view_own",
  feature: "tools",
  input: z.object({ toolIds: z.array(uuid).max(200).optional() }),
  audit: "tool.acknowledged",
  async run({ input, tx, user, activity }) {
    const rows = await tx
      .update(toolAssignments)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(toolAssignments.userId, user.id),
          isNull(toolAssignments.checkedInAt),
          isNull(toolAssignments.acknowledgedAt),
          input.toolIds?.length
            ? inArray(toolAssignments.toolId, input.toolIds)
            : undefined,
        ),
      )
      .returning({ toolId: toolAssignments.toolId });
    for (const r of rows)
      await activity({
        entity: toolEntity(r.toolId),
        kind: "tool.acknowledged",
        summary: "Receipt acknowledged",
      });
    return { count: rows.length };
  },
  revalidate: () => toolPaths(),
});

/** Status changes: send to repair, return from repair (condition + photo), retire. */
export const setToolStatus = action({
  perm: "tools.manage",
  feature: "tools",
  input: z.object({
    toolId: uuid,
    status: z.enum(["available", "in_repair", "retired"]),
    condition: condition.optional(),
    mediaId: optUuid,
  }),
  audit: "tool.status_changed",
  async run({ input, tx, user, activity }) {
    const t = await loadTool(tx, input.toolId);
    if (t.status === "in_repair" && input.status === "available") {
      if (!input.condition)
        throw new ValidationError({
          condition: ["Rate its condition after repair."],
        });
      if (!(await verifyMedia(tx, input.mediaId, user.id)))
        throw new ValidationError({
          mediaId: ["Take a photo of the repaired tool."],
        });
    }
    if (
      input.status !== "in_repair" &&
      t.status === "assigned" &&
      input.status === "retired"
    )
      await closeOpenAssignment(tx, t.id, {
        condition: t.condition,
        mediaId: null,
      });
    await tx
      .update(tools)
      .set({
        status: input.status,
        condition: input.condition ?? t.condition,
        ...(input.status === "retired"
          ? { currentUserId: null, currentVehicleId: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tools.id, t.id));
    await activity({
      entity: toolEntity(t.id),
      kind: "tool.status_changed",
      summary:
        input.status === "available"
          ? "Back from repair"
          : input.status === "in_repair"
            ? "Sent to repair"
            : "Retired",
      data: {
        from: t.status,
        to: input.status,
        media_id: input.mediaId ?? null,
      },
    });
    return { id: t.id };
  },
  auditEntity: ({ input }) => toolEntity(input.toolId),
  revalidate: ({ input }) => toolPaths(input.toolId),
});

// ------------------------------------------------------------------ kits

export const saveKit = action({
  perm: "tools.manage",
  feature: "tools",
  input: z.object({
    id: uuid.optional(),
    name: z.string().trim().min(1, "Name the kit.").max(80),
    vehicleId: optUuid,
    userId: optUuid,
    toolIds: z.array(uuid).max(200).default([]),
  }),
  audit: "tool.kit_saved",
  async run({ input, tx }) {
    let id = input.id;
    if (id) {
      await tx
        .update(toolKits)
        .set({
          name: input.name,
          vehicleId: input.vehicleId ?? null,
          userId: input.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(toolKits.id, id));
    } else {
      const [k] = await tx
        .insert(toolKits)
        .values({
          name: input.name,
          vehicleId: input.vehicleId ?? null,
          userId: input.userId ?? null,
        })
        .returning({ id: toolKits.id });
      id = k?.id;
    }
    if (!id) throw new Error("kit save failed");
    await tx.update(tools).set({ kitId: null }).where(eq(tools.kitId, id));
    if (input.toolIds.length)
      await tx
        .update(tools)
        .set({ kitId: id, updatedAt: new Date() })
        .where(inArray(tools.id, input.toolIds));
    return { id };
  },
  auditEntity: ({ data }) => ({ type: "tool_kit", id: data.id }),
  revalidate: () => ["/tools"],
});

/** Assign a whole kit in one action (to its vehicle / tech). */
export const assignKit = action({
  perm: "tools.manage",
  feature: "tools",
  input: z.object({
    kitId: uuid,
    condition: condition.default("good"),
    mediaId: optUuid,
  }),
  audit: "tool.kit_assigned",
  async run({ input, tx, user, activity }) {
    const [k] = await tx
      .select()
      .from(toolKits)
      .where(eq(toolKits.id, input.kitId))
      .limit(1);
    if (!k) throw new NotFoundError("Kit");
    if (!k.vehicleId && !k.userId)
      throw new ValidationError({
        kitId: ["Give the kit a vehicle or a tech first."],
      });
    const settings = (await getSettings()).tools;
    const photo = await verifyMedia(tx, input.mediaId, user.id);
    if (settings.require_handoff_photo && !photo)
      throw new ValidationError({
        mediaId: ["Take a photo of the kit at handoff."],
      });
    const today = await companyToday();
    const list = await tx
      .select()
      .from(tools)
      .where(and(eq(tools.kitId, k.id), isNull(tools.deletedAt)));
    const ok = list.filter(
      (t) =>
        !checkoutBlock(t, today, {
          blockOnCalibration: settings.block_on_calibration_overdue,
          allowReassign: true,
        }),
    );
    for (const t of ok) {
      await closeOpenAssignment(tx, t.id, {
        condition: t.condition,
        mediaId: null,
      });
      await tx.insert(toolAssignments).values({
        toolId: t.id,
        userId: k.userId,
        vehicleId: k.vehicleId,
        outCondition: input.condition,
        outMediaId: photo,
        byUserId: user.id,
      });
      await tx
        .update(tools)
        .set({
          status: "assigned",
          currentUserId: k.userId,
          currentVehicleId: k.vehicleId,
          updatedAt: new Date(),
        })
        .where(eq(tools.id, t.id));
      await activity({
        entity: toolEntity(t.id),
        kind: "tool.checked_out",
        summary: `Checked out with kit “${k.name}”`,
      });
    }
    return { assigned: ok.length, skipped: list.length - ok.length };
  },
  auditEntity: ({ input }) => ({ type: "tool_kit", id: input.kitId }),
  revalidate: () => toolPaths(),
});

// ------------------------------------------------------------------ maintenance

export const logToolMaintenance = action({
  name: "tools.logMaintenance",
  perm: "tools.maintenance_log",
  feature: "tools",
  input: z.object({
    toolId: uuid,
    task: z.string().trim().min(1, "What was done?").max(80),
    performedOn: dayKey,
    vendor: optText(120),
    costCents: optInt(0, 10_000_000),
    paidBy: z.enum(["company", "tech"]).default("company"),
    mediaId: optUuid,
    notes: optText(1000),
    calibrated: z.boolean().default(false),
    nextCalibrationOn: optDay,
    clientId: uuid.optional(),
  }),
  audit: "tool.maintenance_logged",
  async run({ input, tx, user, actor, activity }) {
    const t = await loadTool(tx, input.toolId);
    const manage = user.perms.has("tools.manage");
    if (!manage && t.currentUserId !== user.id && t.ownerUserId !== user.id)
      throw new ForbiddenError(
        "You can log maintenance only for tools in your custody.",
      );
    const id = input.clientId ?? crypto.randomUUID();
    const photo =
      (await verifyMedia(tx, input.mediaId, user.id)) ??
      (await photosOf(tx, "tool", id, user.id))[0] ??
      null;
    let partPurchaseId: string | null = null;
    if (input.paidBy === "tech" && input.costCents) {
      const pp = await createPartPurchase(
        tx,
        {
          paidBy: "tech",
          instrument: "personal",
          purchaserUserId: user.id,
          category: "tool",
          toolId: t.id,
          vendor: input.vendor ?? null,
          purchasedOn: input.performedOn,
          totalCents: input.costCents,
          receiptMediaId: photo,
          notes: `${t.name}: ${input.task}`,
        },
        actor,
      );
      partPurchaseId = pp.partPurchaseId;
    }
    await tx.insert(toolMaintenanceLogs).values({
      id,
      toolId: t.id,
      task: input.task,
      performedOn: input.performedOn,
      performedByUserId: user.id,
      vendor: input.vendor ?? null,
      costCents: input.costCents,
      paidBy: input.paidBy,
      partPurchaseId,
      mediaId: photo,
      notes: input.notes ?? null,
      clientId: input.clientId ?? null,
    });
    // Logging resets the due date (never moves it backwards).
    const last =
      !t.lastMaintainedOn || input.performedOn > t.lastMaintainedOn
        ? input.performedOn
        : t.lastMaintainedOn;
    await tx
      .update(tools)
      .set({
        lastMaintainedOn: last,
        nextMaintenanceOn: nextMaintenanceOn(last, t.maintenanceIntervalDays),
        ...(input.calibrated
          ? { calibrationDueOn: input.nextCalibrationOn ?? null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tools.id, t.id));
    await activity({
      entity: toolEntity(t.id),
      kind: "tool.maintenance_logged",
      summary: `Maintenance: ${input.task}`,
      data: { log_id: id, paid_by: input.paidBy },
    });
    return { id };
  },
  auditEntity: ({ input }) => toolEntity(input.toolId),
  revalidate: ({ input }) => toolPaths(input.toolId),
});

// ------------------------------------------------------------------ incidents

export const reportToolIncident = action({
  name: "tools.reportIncident",
  perm: "tools.report_incident",
  feature: "tools",
  input: z.object({
    toolId: uuid,
    kind: z.enum(["lost", "stolen", "damaged"]),
    description: z.string().trim().min(3, "Say what happened.").max(2000),
    mediaIds: z.array(uuid).max(12).default([]),
    policeReportNo: optText(60),
    clientId: uuid.optional(),
  }),
  audit: "tool.incident_reported",
  async run({ input, tx, user, emit, activity }) {
    const t = await loadTool(tx, input.toolId);
    if (
      !user.perms.has("tools.view_all") &&
      t.currentUserId !== user.id &&
      t.ownerUserId !== user.id
    )
      throw new ForbiddenError("You can report only tools in your custody.");
    const id = input.clientId ?? crypto.randomUUID();
    await tx.insert(toolIncidents).values({
      id,
      toolId: t.id,
      userId: t.currentUserId ?? user.id,
      kind: input.kind,
      description: input.description,
      mediaIds: input.mediaIds,
      policeReportNo: input.policeReportNo ?? null,
    });
    await tx
      .update(tools)
      .set({
        status: input.kind === "damaged" ? "in_repair" : input.kind,
        condition: input.kind === "damaged" ? "poor" : t.condition,
        updatedAt: new Date(),
      })
      .where(eq(tools.id, t.id));
    await emit("tool.incident", toolEntity(t.id), {
      incident_id: id,
      tool_id: t.id,
      user_id: t.currentUserId ?? user.id,
      kind: input.kind,
    });
    await activity({
      entity: toolEntity(t.id),
      kind: "tool.incident",
      summary: `Reported ${input.kind}`,
      data: { incident_id: id },
    });
    await notify(tx, {
      to: { perm: "tools.audit_review" },
      type: "staff.generic",
      title: `Tool ${input.kind}: ${t.name}`,
      body: input.description.slice(0, 140),
      url: `/tools/${t.id}`,
      entity: toolEntity(t.id),
      priority: input.kind === "stolen" ? "high" : "normal",
    });
    return { id };
  },
  auditEntity: ({ data }) => ({ type: "tool_incident", id: data.id }),
  revalidate: ({ input }) => toolPaths(input.toolId),
});

/**
 * Admin decision: write_off | repair | tech_responsibility. The latter creates a
 * PENDING `tool_deduction` (needs review) only when deductions are on, not blocked
 * for W-2 in the company state, and the tech signed the tool agreement (⚖️).
 */
export const decideToolIncident = action({
  perm: "tools.audit_review",
  feature: "tools",
  input: z.object({
    incidentId: uuid,
    decision: z.enum(["write_off", "repair", "tech_responsibility"]),
    amountCents: optInt(1, 10_000_000),
  }),
  audit: "tool.incident_decided",
  async run({ input, tx, actor, activity }) {
    const [i] = await tx
      .select()
      .from(toolIncidents)
      .where(eq(toolIncidents.id, input.incidentId))
      .limit(1);
    if (!i) throw new NotFoundError("Incident");
    if (i.decision)
      throw new ConflictError("decided", "This incident was already decided.");
    const t = await loadTool(tx, i.toolId);
    let ledgerId: string | null = null;
    if (input.decision === "tech_responsibility") {
      if (!i.userId)
        throw new ValidationError({
          decision: ["No tech is linked to this incident."],
        });
      const settings = await getSettings();
      const [[u], [c]] = await Promise.all([
        tx
          .select({ workerType: users.workerType })
          .from(users)
          .where(eq(users.id, i.userId))
          .limit(1),
        tx.select({ state: company.state }).from(company).limit(1),
      ]);
      const allowed = deductionAllowed({
        enabled: settings.tools.deductions_enabled,
        workerType: (u?.workerType ?? "w2") as "w2" | "1099",
        companyState: c?.state ?? null,
        blockedStates: settings.compliance.wage_deduction_blocked_states,
        agreementSigned: await hasSignature("tool_agreement", i.userId),
      });
      if (!allowed.ok)
        throw new ConflictError("deduction_blocked", allowed.reason);
      const amount =
        input.amountCents ?? t.replacementCostCents ?? t.purchaseCostCents ?? 0;
      if (amount <= 0)
        throw new ValidationError({
          amountCents: ["Enter the deduction amount."],
        });
      const res = await postLedgerEntry(
        tx,
        {
          userId: i.userId,
          type: "tool_deduction",
          amountCents: -Math.abs(amount),
          effectiveDate: await companyToday(),
          refTable: "tool_incidents",
          refId: i.id,
          memo: `${t.name} (${i.kind})`,
          needsReview: true,
        },
        actor,
      );
      ledgerId = res.ledgerEntryId;
    }
    await tx
      .update(toolIncidents)
      .set({
        decision: input.decision,
        decidedBy: actor.userId,
        decidedAt: new Date(),
        deductionLedgerEntryId: ledgerId,
      })
      .where(eq(toolIncidents.id, i.id));
    const status =
      input.decision === "repair"
        ? "in_repair"
        : input.decision === "write_off"
          ? "retired"
          : t.status;
    await tx
      .update(tools)
      .set({
        status,
        ...(status === "retired"
          ? { currentUserId: null, currentVehicleId: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(tools.id, t.id));
    if (status === "retired")
      await closeOpenAssignment(tx, t.id, {
        condition: t.condition,
        mediaId: null,
      });
    await activity({
      entity: toolEntity(t.id),
      kind: "tool.incident_decided",
      summary: `Incident decided: ${input.decision.replace(/_/g, " ")}${ledgerId ? " (deduction pending review)" : ""}`,
      data: { incident_id: i.id, ledger_entry_id: ledgerId },
    });
    return { id: i.id, toolId: t.id };
  },
  auditEntity: ({ input }) => ({ type: "tool_incident", id: input.incidentId }),
  revalidate: ({ data }) => toolPaths(data.toolId),
});

// ------------------------------------------------------------------ audits

export const scheduleAudit = action({
  perm: "tools.audit_review",
  feature: "tools",
  input: z.object({ userId: uuid, dueOn: dayKey }),
  audit: "tool.audit_scheduled",
  async run({ input, tx, actor }) {
    const id = await scheduleAuditFor(tx, input.userId, input.dueOn, actor);
    if (!id)
      throw new ConflictError(
        "no_audit",
        "This tech has no tools in custody or already has an open tool check.",
      );
    return { id };
  },
  auditEntity: ({ data }) => ({ type: "tool_audit", id: data.id }),
  revalidate: () => ["/tools", "/today"],
});

/** Save one checklist item (photo per tool; missing → incident on submit). */
export const saveAuditItem = action({
  name: "tools.saveAuditItem",
  perm: "tools.audit_submit",
  feature: "tools",
  input: z.object({
    itemId: uuid,
    present: z.boolean(),
    condition: condition.nullish(),
    mediaId: optUuid,
    note: optText(500),
  }),
  async run({ input, tx, user }) {
    const [row] = await tx
      .select({ item: toolAuditItems, audit: toolAudits })
      .from(toolAuditItems)
      .innerJoin(toolAudits, eq(toolAudits.id, toolAuditItems.auditId))
      .where(eq(toolAuditItems.id, input.itemId))
      .limit(1);
    if (!row) throw new NotFoundError("Checklist item");
    if (row.audit.userId !== user.id)
      throw new ForbiddenError("This isn't your tool check.");
    if (row.audit.status !== "scheduled" && row.audit.status !== "in_progress")
      throw new ConflictError(
        "audit_closed",
        "This tool check was already submitted.",
      );
    const photo =
      (await verifyMedia(tx, input.mediaId, user.id)) ?? row.item.mediaId;
    await tx
      .update(toolAuditItems)
      .set({
        present: input.present,
        condition: input.present ? (input.condition ?? null) : null,
        mediaId: input.present ? photo : null,
        note: input.note ?? null,
      })
      .where(eq(toolAuditItems.id, input.itemId));
    if (row.audit.status === "scheduled")
      await tx
        .update(toolAudits)
        .set({ status: "in_progress" })
        .where(eq(toolAudits.id, row.audit.id));
    return { id: input.itemId, auditId: row.audit.id };
  },
  revalidate: ({ data }) => [`/tools/audits/${data.auditId}`],
});

export const submitAudit = action({
  name: "tools.submitAudit",
  perm: "tools.audit_submit",
  feature: "tools",
  input: z.object({ auditId: uuid }),
  audit: "tool.audit_submitted",
  async run({ input, tx, user, emit, activity }) {
    const [a] = await tx
      .select()
      .from(toolAudits)
      .where(eq(toolAudits.id, input.auditId))
      .limit(1);
    if (!a) throw new NotFoundError("Tool check");
    if (a.userId !== user.id)
      throw new ForbiddenError("This isn't your tool check.");
    if (a.status !== "scheduled" && a.status !== "in_progress")
      throw new ConflictError("audit_closed", "Already submitted.");
    const items = await tx
      .select({ i: toolAuditItems, name: tools.name })
      .from(toolAuditItems)
      .innerJoin(tools, eq(tools.id, toolAuditItems.toolId))
      .where(eq(toolAuditItems.auditId, a.id));
    const unanswered = items.filter((x) => x.i.present == null);
    if (unanswered.length)
      throw new ValidationError(
        {
          items: [
            `Check every tool: ${unanswered.map((x) => x.name).join(", ")}`,
          ],
        },
        "Some tools aren't checked yet.",
      );
    const noPhoto = items.filter((x) => x.i.present && !x.i.mediaId);
    if (noPhoto.length)
      throw new ValidationError(
        {
          items: [`Add a photo for: ${noPhoto.map((x) => x.name).join(", ")}`],
        },
        "Every tool you have needs a photo.",
      );
    await tx
      .update(toolAudits)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(toolAudits.id, a.id));
    const missing = items.filter((x) => x.i.present === false);
    for (const m of missing) {
      const incidentId = crypto.randomUUID();
      await tx.insert(toolIncidents).values({
        id: incidentId,
        toolId: m.i.toolId,
        userId: user.id,
        kind: "lost",
        description: `Missing at tool check (due ${a.dueOn})${m.i.note ? `: ${m.i.note}` : ""}`,
      });
      await tx
        .update(tools)
        .set({ status: "lost", updatedAt: new Date() })
        .where(eq(tools.id, m.i.toolId));
      await emit("tool.incident", toolEntity(m.i.toolId), {
        incident_id: incidentId,
        tool_id: m.i.toolId,
        user_id: user.id,
        kind: "lost",
      });
      await activity({
        entity: toolEntity(m.i.toolId),
        kind: "tool.incident",
        summary: "Missing at tool check",
        data: { incident_id: incidentId },
      });
    }
    // Conditions reported at the check update the register.
    for (const x of items)
      if (x.i.present && x.i.condition)
        await tx
          .update(tools)
          .set({ condition: x.i.condition })
          .where(eq(tools.id, x.i.toolId));
    const entity = { type: "user" as const, id: user.id };
    await emit("tool.audit_submitted", entity, {
      audit_id: a.id,
      user_id: user.id,
    });
    await activity({
      entity,
      kind: "tool.audit_submitted",
      summary: `Tool check submitted: ${items.length - missing.length}/${items.length} present`,
      data: { audit_id: a.id, missing: missing.length },
    });
    return { id: a.id, missing: missing.length };
  },
  auditEntity: ({ input }) => ({ type: "tool_audit", id: input.auditId }),
  revalidate: ({ input }) => [
    "/tools",
    "/today",
    `/tools/audits/${input.auditId}`,
  ],
});

export const reviewAudit = action({
  perm: "tools.audit_review",
  feature: "tools",
  input: z.object({ auditId: uuid }),
  audit: "tool.audit_reviewed",
  async run({ input, tx, user }) {
    const res = await tx
      .update(toolAudits)
      .set({ status: "reviewed", reviewedBy: user.id, reviewedAt: new Date() })
      .where(
        and(
          eq(toolAudits.id, input.auditId),
          eq(toolAudits.status, "submitted"),
        ),
      )
      .returning({ id: toolAudits.id });
    if (!res.length)
      throw new ConflictError(
        "not_submitted",
        "Only submitted tool checks can be reviewed.",
      );
    return { id: input.auditId };
  },
  auditEntity: ({ input }) => ({ type: "tool_audit", id: input.auditId }),
  revalidate: ({ input }) => ["/tools", `/tools/audits/${input.auditId}`],
});

// ------------------------------------------------------------------ agreement

/** Consumer action for the B3 SignatureSheet (doc type `tool_agreement`). */
export async function signToolAgreement(input: SignatureSubmit) {
  return signToolAgreementAction(input);
}

const signToolAgreementAction = action({
  name: "tools.signAgreement",
  perm: "tools.view_own",
  feature: "tools",
  input: z.object({
    signerName: z.string().trim().min(2).max(120),
    esignConsent: z.literal(true),
    signatureMediaId: uuid,
    geo: z
      .object({
        lat: z.number(),
        lng: z.number(),
        accuracyM: z.number().nullish(),
        at: z.string().optional(),
      })
      .nullish(),
    deviceTs: z.string().max(40),
    clientId: uuid,
  }),
  audit: "tool.agreement_signed",
  async run({ input, tx, user, actor }) {
    const settings = (await getSettings()).tools;
    const held = await tx
      .select({ name: tools.name, serial: tools.serial })
      .from(tools)
      .where(and(eq(tools.currentUserId, user.id), isNull(tools.deletedAt)));
    const text = settings.agreement_text ?? DEFAULT_AGREEMENT;
    const res = await captureSignature(
      tx,
      {
        docType: "tool_agreement",
        docId: user.id,
        docSnapshot: { text, tools: held, signed_for: user.name },
        signerName: input.signerName,
        signerKind: "user",
        signerUserId: user.id,
        signatureMediaId: input.signatureMediaId,
        channel: "in_person",
        esignConsent: true,
        consentText: text,
        geo: input.geo ?? null,
        deviceTs: new Date(input.deviceTs),
      },
      actor,
    );
    return { signatureId: res.signatureId };
  },
  revalidate: () => ["/tools"],
});

const DEFAULT_AGREEMENT =
  "I received the company tools listed in my custody. I'll use them for company work, keep them secure, report loss, theft or damage right away, and return them when asked or when I leave.";

// ------------------------------------------------------------------ settings

export const saveToolSettings = action({
  perm: "settings.manage",
  input: z.object({
    audit_frequency_days: z.coerce.number().int().min(7).max(365),
    deductions_enabled: z.boolean(),
    agreement_text: z.preprocess(
      (v) => (typeof v === "string" && !v.trim() ? null : v),
      z.string().max(4000).nullable(),
    ),
    block_on_calibration_overdue: z.boolean(),
    require_handoff_photo: z.boolean(),
    maintenance_warning_days: z.coerce.number().int().min(0).max(60),
    // 0 = no default (settings records merge, so removing a key is "set it to 0").
    maintenance_interval_days_by_category: z.record(
      z.string().trim().min(1).max(60),
      z.coerce.number().int().min(0).max(3650),
    ),
  }),
  audit: "settings.tools_updated",
  async run({ input, tx, actor }) {
    await updateSettings(tx, { tools: input }, actor);
    return { ok: true };
  },
  revalidate: () => ["/settings/tools", "/tools"],
});
