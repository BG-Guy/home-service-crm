// Event handlers for `parts` (BUILD_PLAN §4, §7). Owner: B6.
// Each handler runs in its own transaction and MUST be idempotent (events are retried
// until every handler succeeds). Name handlers 'parts.<what>'. Slow work → enqueueJob().
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { invoices, jobs, lineItems, tasks } from "@/db/schema";
import { settingsOf } from "@/features/payroll/server/util";
import { createTask } from "@/features/tasks/api";
import type { HandlerReg, IgnoreReg } from "@/lib/events";
import { SYSTEM_ACTOR } from "@/lib/types";

export const handlers: HandlerReg[] = [
  {
    // SPEC M15 warranty claims (MVP-lite): a callback with reason "part" → a
    // warranty_claim task listing the original job's warrantied parts.
    event: "job.callback_created",
    name: "parts.warranty_claim",
    async run(e, { tx }) {
      const pl = e.payload as {
        job_id: string;
        original_job_id: string;
        reason: string;
      };
      if (pl.reason !== "part") return;
      const [dup] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.kind, "warranty_claim"),
            eq(tasks.entityType, "job"),
            eq(tasks.entityId, pl.job_id),
          ),
        )
        .limit(1);
      if (dup) return;
      const [orig] = await tx
        .select({
          id: jobs.id,
          number: jobs.number,
          customerId: jobs.customerId,
        })
        .from(jobs)
        .where(eq(jobs.id, pl.original_job_id))
        .limit(1);
      const [cb] = await tx
        .select({ number: jobs.number, customerId: jobs.customerId })
        .from(jobs)
        .where(eq(jobs.id, pl.job_id))
        .limit(1);
      const invs = orig
        ? await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(eq(invoices.jobId, orig.id), ne(invoices.status, "void")),
            )
        : [];
      const parts = invs.length
        ? await tx
            .select({
              id: lineItems.id,
              name: lineItems.name,
              months: lineItems.manufacturerWarrantyMonths,
              days: lineItems.warrantyDays,
              serial: lineItems.serial,
            })
            .from(lineItems)
            .where(
              and(
                eq(lineItems.parentType, "invoice"),
                inArray(
                  lineItems.parentId,
                  invs.map((i) => i.id),
                ),
                inArray(lineItems.type, ["part", "material"]),
              ),
            )
        : [];
      const s = await settingsOf(tx);
      const lines = parts.map(
        (p) =>
          `${p.name}${p.months ? ` · ${p.months} mo manufacturer warranty` : ""}${p.serial ? ` · S/N ${p.serial}` : ""}`,
      );
      await createTask(
        tx,
        {
          kind: "warranty_claim",
          title: `Warranty claim: part failed on ${orig?.number ?? "a previous job"}`,
          body: lines.length
            ? `Parts on the original job:\n${lines.join("\n")}`
            : "No part lines found on the original job.",
          payload: {
            callback_job_id: pl.job_id,
            original_job_id: pl.original_job_id,
            line_item_ids: parts.map((p) => p.id),
          },
          assigneeUserId: null,
          entity: { type: "job", id: pl.job_id },
          customerId: cb?.customerId ?? orig?.customerId ?? null,
          jobId: pl.job_id,
          dueAt: new Date(
            Date.now() + s.parts.warranty_claim_days * 86_400_000,
          ),
        },
        SYSTEM_ACTOR,
      );
    },
  },
];

/** Event types this module deliberately does not handle (coverage check). */
export const ignores: IgnoreReg[] = [];
