"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { JOB_KINDS } from "../kinds";
import { getAvailability, getDayAvailability } from "./index";
import type { DayAvailability } from "./types";

// Booking availability reads for the client (the week strip refetches when the job
// type changes; a day's windows load on tap). Reads, not mutations: no action().

/** Longest range one call may ask for (days). */
const MAX_RANGE_DAYS = 120;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optUuid = z.uuid().nullish().catch(null);

const jobShape = {
  propertyId: optUuid,
  address: z
    .object({
      street: z.string().max(200),
      city: z.string().max(100).nullish(),
      state: z.string().max(40).nullish(),
      zip: z.string().max(10),
    })
    .nullish()
    .catch(null),
  serviceTypeId: optUuid,
  kind: z.enum(JOB_KINDS).nullish().catch(null),
  durationMin: z.number().int().min(15).max(1440).nullish().catch(null),
  requestedDate: dateKey.nullish().catch(null),
};

const dayInput = z.object({ ...jobShape, date: dateKey });
const rangeInput = z.object({ ...jobShape, from: dateKey, to: dateKey });

/** One day's arrival windows for the booking calendar (read; loaded on tap). */
export async function fetchDayWindows(input: {
  propertyId?: string | null;
  address?: z.input<typeof jobShape.address>;
  serviceTypeId?: string | null;
  kind?: string | null;
  durationMin?: number | null;
  requestedDate?: string | null;
  date: string;
}): Promise<DayAvailability | null> {
  await requireUser("jobs.create");
  const p = dayInput.safeParse(input);
  if (!p.success) return null;
  const { date, ...job } = p.data;
  if (!job.propertyId && !job.address) return null;
  return getDayAvailability(job, date);
}

/** Days in a range (statuses and reasons, no windows), e.g. after the job type changes. */
export async function fetchAvailability(input: {
  propertyId?: string | null;
  address?: z.input<typeof jobShape.address>;
  serviceTypeId?: string | null;
  kind?: string | null;
  durationMin?: number | null;
  requestedDate?: string | null;
  from: string;
  to: string;
}): Promise<DayAvailability[]> {
  await requireUser("jobs.create");
  const p = rangeInput.safeParse(input);
  if (!p.success) return [];
  const { from, to, ...job } = p.data;
  if (!job.propertyId && !job.address) return [];
  const days =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;
  if (!(days >= 0 && days < MAX_RANGE_DAYS)) return [];
  return getAvailability({ ...job, from, to });
}
