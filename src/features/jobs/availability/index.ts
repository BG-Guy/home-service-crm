import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { properties, roles, users } from "@/db/schema";
import { getUserBriefs } from "@/features/team/api";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey, zonedParts } from "@/lib/time";
import { colorFor } from "../dispatch/queries";
import { type MockTech, mockAvailability } from "./mock";
import type { AvailabilityInput, DayAvailability } from "./types";

// Booking availability (call-to-booking flow, /leads/new/schedule). One entry
// point so the engine can be swapped without UI changes.
//
// TODO(algo): today this returns MOCK data (./mock.ts): deterministic per date and
// address, real tech names and colors. The real engine replaces the
// `mockAvailability` call below and should use the techs' booked jobs, home bases,
// skills (input.serviceTypeId), time off and the Assign hub's `recommendTechs`
// (../dispatch/recommend.ts) per window. Callers check permissions first.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function activeTechs(): Promise<MockTech[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, color: users.color })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(
      and(
        eq(users.status, "active"),
        or(eq(roles.baseRole, "tech"), eq(users.role, "tech")),
      ),
    )
    .orderBy(asc(users.name));
  const briefs = await getUserBriefs(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: colorFor(r.id, r.color),
    avatarUrl: briefs[r.id]?.avatarUrl ?? null,
  }));
}

async function addressKey(i: AvailabilityInput): Promise<string> {
  if (i.propertyId && UUID_RE.test(i.propertyId)) {
    const [p] = await db
      .select({ street: properties.street, zip: properties.zip })
      .from(properties)
      .where(eq(properties.id, i.propertyId))
      .limit(1);
    if (p) return `${p.street.trim().toLowerCase()}|${p.zip}`;
  }
  const a = i.address;
  return a ? `${a.street.trim().toLowerCase()}|${a.zip.trim()}` : "none";
}

/** Bookable days (and, with `withWindows`, their arrival windows) for a job location. */
export async function getAvailability(
  input: AvailabilityInput,
): Promise<DayAvailability[]> {
  if (!DATE_RE.test(input.from) || !DATE_RE.test(input.to)) return [];
  const [tz, settings, techs, key] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
    activeTechs(),
    addressKey(input),
  ]);
  const now = new Date();
  const p = zonedParts(now, tz);
  return mockAvailability({
    from: input.from,
    to: input.to,
    addressKey: key,
    serviceTypeId: input.serviceTypeId ?? null,
    techs,
    hours: settings.company.business_hours,
    todayKey: dateKey(now, tz),
    nowMin: p.hour * 60 + p.minute,
    withWindows: input.withWindows,
  });
}

/** One day with its windows (null when the day is out of range or in the past). */
export async function getDayAvailability(
  input: Omit<AvailabilityInput, "from" | "to" | "withWindows">,
  date: string,
): Promise<DayAvailability | null> {
  const [d] = await getAvailability({
    ...input,
    from: date,
    to: date,
    withWindows: true,
  });
  return d ?? null;
}

export type {
  AvailabilityInput,
  DayAvailability,
  DayStatus,
  TechSuggestion,
  WindowSlot,
} from "./types";
