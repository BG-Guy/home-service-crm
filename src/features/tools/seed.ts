// Demo seed fragment for `tools` (BUILD_PLAN §10.3 row 18). Owner: B7.
// 12 tools from the profile (default: key machine calibration due in 5 d), the profile's
// kit (default "Locksmith kit") → Van 1,
// acknowledged assignments, tech1's tool check due tomorrow, tech2's submitted check
// with one missing tool → a pending "lost" incident, one maintenance log.
// Writes only B7 tables (+ seedPlaceholderMedia); never emits events.
import type { DB } from "@/db";
import {
  toolAssignments,
  toolAuditItems,
  toolAudits,
  toolIncidents,
  toolKits,
  toolMaintenanceLogs,
  tools,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";
import { dateKey } from "@/lib/time";
import { assetTag, nextMaintenanceOn } from "./rules";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const { plan, tz } = ctx;
  // Kit, maintenance plans, the missing tool and category colors come from the profile.
  const tooling = ctx.profile.tooling;
  const COLOR = tooling.categoryColors;
  const MAINT = tooling.maintenance;
  const users = Object.fromEntries(plan.users.map((u) => [u.key, u.id]));
  const vehicleOf = Object.fromEntries(
    plan.vehicles.map((v) => [v.assignedTo, v.id]),
  );
  const day = (d: number) => dateKey(ctx.at(d, "12:00"), tz);
  const kitId = seedId("tool_kit", tooling.kit.key);
  const v1 = plan.vehicles.find((v) => v.key === "v1");

  await db
    .insert(toolKits)
    .values({
      id: kitId,
      name: tooling.kit.name,
      vehicleId: v1?.id ?? null,
      userId: users.tech1,
    })
    .onConflictDoNothing();

  for (const [i, t] of plan.tools.entries()) {
    const m = MAINT[t.key];
    const last = m ? day(m[2]) : null;
    const holder = t.assignedTo ? (users[t.assignedTo] as string) : null;
    const missing = t.key === tooling.missing.key; // tech2's tool check reports it missing
    await seedPlaceholderMedia(db, {
      id: seedId("media", `tool:${t.key}`),
      kind: "photo",
      tag: "tool",
      entity: { type: "tool", id: t.id },
      label: t.name.split(" ").slice(0, 2).join(" "),
      color: COLOR[t.category] ?? "#8E8E93",
      capturedAt: ctx.at(-180, "10:00"),
    });
    await db
      .insert(tools)
      .values({
        id: t.id,
        name: t.name,
        category: t.category,
        brand: t.brand,
        serial: t.serial,
        assetTag: assetTag(i + 1),
        purchaseDate: day(-400 + i * 9),
        purchaseCostCents: t.costCents,
        replacementCostCents: Math.round(t.costCents * 1.08),
        owner: "company",
        status: missing ? "lost" : holder ? "assigned" : "available",
        condition: i % 5 === 3 ? "fair" : "good",
        calibrationDueOn:
          t.calibrationDueInDays != null ? day(t.calibrationDueInDays) : null,
        maintenanceIntervalDays: m?.[1] ?? null,
        maintenanceTask: m?.[0] ?? null,
        lastMaintainedOn: last,
        nextMaintenanceOn: nextMaintenanceOn(last, m?.[1] ?? null),
        kitId: tooling.kit.tools.includes(t.key) ? kitId : null,
        currentUserId: holder,
        currentVehicleId: holder
          ? (vehicleOf[t.assignedTo as string] ?? null)
          : null,
        createdAt: ctx.at(-400 + i * 9, "09:00"),
        updatedAt: ctx.at(-30, "09:00"),
      })
      .onConflictDoNothing();
    if (holder) {
      // Handoff 30 days ago, acknowledged by the tech the same morning.
      await db
        .insert(toolAssignments)
        .values({
          id: seedId("tool_assignment", t.key),
          toolId: t.id,
          userId: holder,
          vehicleId: vehicleOf[t.assignedTo as string] ?? null,
          checkedOutAt: ctx.at(-30, "08:00"),
          outCondition: "good",
          acknowledgedAt: ctx.at(-30, "08:12"),
          byUserId: users.admin,
        })
        .onConflictDoNothing();
    }
  }

  // One maintenance log (drill_1 battery check in the default demo).
  const logged = plan.tools.find((t) => t.key === tooling.maintenanceLog.key);
  const loggedPlan = MAINT[tooling.maintenanceLog.key];
  if (logged && loggedPlan)
    await db
      .insert(toolMaintenanceLogs)
      .values({
        id: seedId("tool_maint", logged.key),
        toolId: logged.id,
        task: loggedPlan[0],
        performedOn: day(loggedPlan[2]),
        performedByUserId:
          users[logged.assignedTo ?? "tech1"] ?? (users.tech1 as string),
        notes: tooling.maintenanceLog.note,
        createdAt: ctx.at(loggedPlan[2], "17:30"),
      })
      .onConflictDoNothing();

  // tech1: tool check due tomorrow (scheduled, one item per tool in custody).
  const tech1Tools = plan.tools.filter((t) => t.assignedTo === "tech1");
  const a1 = seedId("tool_audit", "tech1-next");
  await db
    .insert(toolAudits)
    .values({
      id: a1,
      userId: users.tech1 as string,
      dueOn: day(1),
      status: "scheduled",
      // Never in the future when seeding before 05:20 (QA T3-19).
      createdAt: new Date(
        Math.min(ctx.at(0, "05:20").getTime(), ctx.now.getTime() - 60_000),
      ),
    })
    .onConflictDoNothing();
  await db
    .insert(toolAuditItems)
    .values(
      tech1Tools.map((t) => ({
        id: seedId("tool_audit_item", `tech1:${t.key}`),
        auditId: a1,
        toolId: t.id,
      })),
    )
    .onConflictDoNothing();

  // tech2: submitted 3 days ago with one tool missing (the multimeter in the default
  // demo) → pending "lost" incident.
  const tech2Tools = plan.tools.filter((t) => t.assignedTo === "tech2");
  const a2 = seedId("tool_audit", "tech2-last");
  await db
    .insert(toolAudits)
    .values({
      id: a2,
      userId: users.tech2 as string,
      dueOn: day(-3),
      status: "submitted",
      submittedAt: ctx.at(-3, "16:40"),
      createdAt: ctx.at(-4, "05:20"),
    })
    .onConflictDoNothing();
  for (const t of tech2Tools) {
    const missing = t.key === tooling.missing.key;
    const photo = missing
      ? null
      : await seedPlaceholderMedia(db, {
          id: seedId("media", `audit:tech2:${t.key}`),
          kind: "photo",
          tag: "tool",
          entity: { type: "tool_audit", id: a2 },
          uploaderId: users.tech2,
          label: t.name.split(" ")[0] ?? "Tool",
          color: COLOR[t.category] ?? "#8E8E93",
          capturedAt: ctx.at(-3, "16:30"),
        });
    await db
      .insert(toolAuditItems)
      .values({
        id: seedId("tool_audit_item", `tech2:${t.key}`),
        auditId: a2,
        toolId: t.id,
        present: !missing,
        condition: missing ? null : "good",
        mediaId: photo,
        note: missing ? tooling.missing.note : null,
      })
      .onConflictDoNothing();
  }
  const mm = plan.tools.find((t) => t.key === tooling.missing.key);
  if (mm)
    await db
      .insert(toolIncidents)
      .values({
        id: seedId("tool_incident", `tech2-${mm.key}`),
        toolId: mm.id,
        userId: users.tech2,
        kind: "lost",
        description: `Missing at tool check: ${tooling.missing.note}`,
        createdAt: ctx.at(-3, "16:41"),
      })
      .onConflictDoNothing();

  ctx.log(
    `tools: ${plan.tools.length} tools, 1 kit, 2 tool checks, 1 incident`,
  );
}
