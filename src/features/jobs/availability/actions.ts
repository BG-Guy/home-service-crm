"use server";

import { requireUser } from "@/lib/auth/current";
import { getDayAvailability } from "./index";
import type { DayAvailability } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One day's arrival windows for the booking calendar (read; loaded on tap). */
export async function fetchDayWindows(input: {
  propertyId: string;
  serviceTypeId?: string | null;
  date: string;
}): Promise<DayAvailability | null> {
  await requireUser("jobs.create");
  if (!UUID_RE.test(String(input?.propertyId ?? ""))) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input?.date ?? ""))) return null;
  const st = input.serviceTypeId;
  return getDayAvailability(
    {
      propertyId: input.propertyId,
      serviceTypeId: st && UUID_RE.test(st) ? st : null,
    },
    input.date,
  );
}
