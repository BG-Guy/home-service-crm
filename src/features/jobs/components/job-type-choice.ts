// The job type a picker shows and books (leads-flow redesign, item 6): one of the
// three kinds (Free estimate / Service call / Project) and, optionally, one of the
// trade's jobs under it ("What's the job?" chips). Plain module (no "use client"):
// the picker, the caller form, the booking flow, New job and the tests share it.

import { formatMoney } from "@/lib/money";
import type { ServiceTypeOption } from "../contracts";
import { type JobKind, KIND_DEFAULTS, kindOf, splitByKind } from "../kinds";

/** What a picker needs from a job type row (ServiceTypeOption fits). */
export type JobTypeRow = Pick<
  ServiceTypeOption,
  | "id"
  | "name"
  | "kind"
  | "defaultDurationMin"
  | "defaultPriceCents"
  | "requiresOwnershipCheck"
>;

/** The "Other" chip: none of the trade's jobs (the caller form asks them to describe it). */
export const OTHER_JOB = "other";

export interface JobTypeValue {
  kind: JobKind | null;
  /** A trade job's id, `OTHER_JOB`, or null (no chip picked). */
  job: string | null;
}

export const NO_JOB_TYPE: JobTypeValue = { kind: null, job: null };

/** The service type a choice books: the trade job, else the kind's own row. */
export function serviceTypeFor(
  types: readonly JobTypeRow[],
  v: JobTypeValue,
): string | null {
  if (!v.kind) return null;
  if (v.job && v.job !== OTHER_JOB && types.some((t) => t.id === v.job))
    return v.job;
  return splitByKind(types).find((g) => g.kind === v.kind)?.primary?.id ?? null;
}

/** The row behind a choice (the trade job, else the kind's own row). */
export function typeFor(
  types: readonly JobTypeRow[],
  v: JobTypeValue,
): JobTypeRow | null {
  const id = serviceTypeFor(types, v);
  return id ? (types.find((t) => t.id === id) ?? null) : null;
}

/**
 * The picker value for a saved type: a trade job selects its card and chip, a
 * kind's own row selects the card only; `typed` text without a trade job picks
 * "Other". Unknown or archived ids fall back to `kind`.
 */
export function valueFromType(
  types: readonly JobTypeRow[],
  serviceTypeId: string | null | undefined,
  kind?: JobKind | null,
  typed?: string | null,
): JobTypeValue {
  const t = serviceTypeId ? types.find((x) => x.id === serviceTypeId) : null;
  const k = t ? kindOf(t.kind) : (kind ?? null);
  if (!k) return NO_JOB_TYPE;
  const group = splitByKind(types).find((g) => g.kind === k);
  if (t && group?.jobs.some((j) => j.id === t.id))
    return { kind: k, job: t.id };
  return { kind: k, job: typed?.trim() ? OTHER_JOB : null };
}

/** "Service call · Rekey", "Free estimate", "Service call · Other". */
export function choiceLabel(
  types: readonly JobTypeRow[],
  v: JobTypeValue,
  kindLabel: (k: JobKind) => string,
): string {
  if (!v.kind) return "Pick a job type";
  const job =
    v.job === OTHER_JOB
      ? "Other"
      : v.job
        ? types.find((t) => t.id === v.job)?.name
        : null;
  return job ? `${kindLabel(v.kind)} · ${job}` : kindLabel(v.kind);
}

/** What a job type card says about price: "Free", "From $125", "Quote" (null when unknown). */
export function kindPrice(
  kind: JobKind,
  rows: readonly Pick<JobTypeRow, "kind" | "defaultPriceCents">[],
): string | null {
  if (kind === "estimate") return "Free";
  if (kind === "project") return "Quote";
  const prices = rows
    .filter((r) => kindOf(r.kind) === kind && (r.defaultPriceCents ?? 0) > 0)
    .map((r) => r.defaultPriceCents as number);
  return prices.length
    ? `From ${formatMoney(Math.min(...prices), { compactWhole: true })}`
    : null;
}

/** "45 min", "90 min" (under two hours), then "2 h", "4 h 30 min". */
export function visitLength(min: number): string {
  if (min < 120) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Length of the visit: the trade job's, else the kind's own row, else the kind default. */
export function kindDuration(
  rows: readonly JobTypeRow[],
  kind: JobKind,
  serviceTypeId?: string | null,
): number {
  const own = serviceTypeId ? rows.find((r) => r.id === serviceTypeId) : null;
  if (own?.defaultDurationMin) return own.defaultDurationMin;
  const primary = splitByKind(rows).find((g) => g.kind === kind)?.primary;
  return primary?.defaultDurationMin || KIND_DEFAULTS[kind].durationMin;
}
