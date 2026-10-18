import "server-only";
import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  checklistTemplates,
  type JobChecklistItem,
  jobAssignments,
  jobStatusEvents,
  jobs,
} from "@/db/schema";
import { getChecklistTemplate, getServiceType } from "@/features/settings/api";
import { formatMoney } from "@/lib/money";
import type { CompanySettings } from "@/lib/settings";
import type { EntityRef } from "@/lib/types";
import type { JobStatus } from "./contracts";
import { OWNERSHIP_PREFIX } from "./machine";

// Shared server internals for the jobs module (not a cross-module contract).

export type JobRow = typeof jobs.$inferSelect;
export type AssignmentInput = {
  userId: string;
  role: "primary" | "helper";
  splitBps: number;
};

export const jobRef = (id: string): EntityRef => ({ type: "job", id });

export async function loadJobRow(
  tx: Tx,
  jobId: string,
  opts: { lock?: boolean } = {},
): Promise<JobRow | null> {
  const q = tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const [row] = opts.lock ? await q.for("update") : await q;
  return row ?? null;
}

export async function loadAssignees(
  tx: Tx,
  jobId: string,
): Promise<AssignmentInput[]> {
  const rows = await tx
    .select({
      userId: jobAssignments.userId,
      role: jobAssignments.role,
      splitBps: jobAssignments.splitBps,
    })
    .from(jobAssignments)
    .where(eq(jobAssignments.jobId, jobId))
    .orderBy(asc(jobAssignments.assignedAt));
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role === "helper" ? "helper" : "primary",
    splitBps: r.splitBps,
  }));
}

export function primaryOf(a: readonly AssignmentInput[]): string | null {
  return a.find((x) => x.role === "primary")?.userId ?? a[0]?.userId ?? null;
}

/**
 * Exactly one primary, unique users, splits summing to 10 000 bps (the last
 * assignee absorbs rounding). Empty stays empty.
 */
export function normalizeAssignees(
  list: readonly AssignmentInput[],
): AssignmentInput[] {
  const seen = new Set<string>();
  const out: AssignmentInput[] = [];
  for (const a of list) {
    if (!a.userId || seen.has(a.userId)) continue;
    seen.add(a.userId);
    out.push({ ...a, splitBps: Math.max(0, Math.round(a.splitBps)) });
  }
  if (out.length === 0) return out;
  const pIdx = Math.max(
    0,
    out.findIndex((a) => a.role === "primary"),
  );
  out.forEach((a, i) => {
    a.role = i === pIdx ? "primary" : "helper";
  });
  const sum = out.reduce((s, a) => s + a.splitBps, 0);
  if (sum !== 10000) {
    if (out.length === 1)
      out[0] = { ...(out[0] as AssignmentInput), splitBps: 10000 };
    else {
      const even = Math.floor(10000 / out.length);
      out.forEach((a, i) => {
        a.splitBps =
          i === out.length - 1 ? 10000 - even * (out.length - 1) : even;
      });
    }
  }
  return out;
}

export async function insertStatusEvent(
  tx: Tx,
  e: {
    jobId: string;
    from: JobStatus | null;
    to: JobStatus;
    actorUserId: string | null;
    clientTs?: Date | null;
    lat?: number | null;
    lng?: number | null;
    accuracyM?: number | null;
    distanceM?: number | null;
    etaMinutes?: number | null;
    note?: string | null;
    clientId?: string | null;
  },
): Promise<void> {
  await tx
    .insert(jobStatusEvents)
    .values({
      jobId: e.jobId,
      fromStatus: e.from,
      toStatus: e.to,
      actorUserId: e.actorUserId,
      clientTs: e.clientTs ?? null,
      lat: e.lat ?? null,
      lng: e.lng ?? null,
      accuracyM: e.accuracyM ?? null,
      distanceM: e.distanceM ?? null,
      etaMinutes: e.etaMinutes ?? null,
      note: e.note ?? null,
      clientId: e.clientId ?? null,
    })
    .onConflictDoNothing();
}

const DEFAULT_OWNERSHIP_ITEMS: JobChecklistItem[] = [
  {
    id: "id_photo",
    label: "Photo of customer ID",
    type: "photo",
    required: true,
  },
  {
    id: "address_proof",
    label: "Proof of address (bill, lease or registration)",
    type: "photo",
    required: true,
  },
  {
    id: "authority",
    label: "Customer signs they have authority to enter",
    type: "signature",
    required: true,
  },
];

/** Checklist snapshot for a new job: service-type template + ownership check items. */
export async function buildChecklist(
  serviceTypeId: string | null | undefined,
): Promise<JobChecklistItem[]> {
  if (!serviceTypeId) return [];
  const st = await getServiceType(serviceTypeId);
  if (!st) return [];
  const items: JobChecklistItem[] = [];
  if (st.checklistTemplateId) {
    const t = await getChecklistTemplate(st.checklistTemplateId);
    for (const i of t?.items ?? [])
      items.push({
        id: i.id,
        label: i.label,
        type: i.type,
        required: i.required,
        ...(i.options ? { options: i.options } : {}),
      });
  }
  if (st.requiresOwnershipCheck) {
    const [tpl] = await db
      .select({ items: checklistTemplates.items })
      .from(checklistTemplates)
      .where(ilike(checklistTemplates.name, "%ownership%"))
      .limit(1);
    const src = tpl?.items?.length ? tpl.items : DEFAULT_OWNERSHIP_ITEMS;
    for (const i of src)
      items.unshift({
        id: `${OWNERSHIP_PREFIX}${i.id}`,
        label: i.label,
        type: i.type,
        required: true,
        ...(i.options ? { options: i.options } : {}),
      });
  }
  return items;
}

/** Text shown at booking about the service-call fee (snapshotted on the job). */
export function serviceFeeDisclosure(
  s: CompanySettings["jobs"],
): string | null {
  const cents = s.service_call_fee_cents;
  if (!cents) return null;
  return `A ${formatMoney(cents)} service-call fee applies${
    s.service_call_fee_credited
      ? ", credited toward the repair if you approve the work"
      : ""
  }.`;
}

export async function assigneeIdsByJob(
  jobIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (jobIds.length === 0) return out;
  const rows = await db
    .select({ jobId: jobAssignments.jobId, userId: jobAssignments.userId })
    .from(jobAssignments)
    .where(inArray(jobAssignments.jobId, jobIds));
  for (const r of rows)
    out.set(r.jobId, [...(out.get(r.jobId) ?? []), r.userId]);
  return out;
}

export function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function hasStatusEventClientId(
  tx: Tx,
  clientId: string,
): Promise<boolean> {
  const [r] = await tx
    .select({ id: jobStatusEvents.id })
    .from(jobStatusEvents)
    .where(and(eq(jobStatusEvents.clientId, clientId)))
    .limit(1);
  return !!r;
}
