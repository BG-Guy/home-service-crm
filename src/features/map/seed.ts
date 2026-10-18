// Demo seed fragment for `map` (BUILD_PLAN §10.3 row 19). Owner: B7.
// tech_locations for the 3 techs, a few minutes old: tech1 at J70 (in progress),
// tech2 between J72 and J73 (en route), tech3 at J75 (arrived). Never emits events.
import type { DB } from "@/db";
import { techLocations } from "@/db/schema";
import type { DemoSeedCtx } from "@/db/seed/types";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const { plan } = ctx;
  const props = new Map(
    plan.customers.flatMap((c) => c.properties.map((p) => [p.id, p] as const)),
  );
  const job = (n: number) => plan.jobs.find((j) => j.n === n);
  const at = (n: number) => {
    const j = job(n);
    const p = j ? props.get(j.propertyId) : undefined;
    return p ? { lat: p.lat, lng: p.lng, jobId: j?.id ?? null } : null;
  };
  const users = Object.fromEntries(plan.users.map((u) => [u.key, u.id]));
  const minsAgo = (m: number) => new Date(ctx.now.getTime() - m * 60_000);
  const j70 = at(70);
  const j72 = at(72);
  const j73 = at(73);
  const j75 = at(75);
  const rows = [
    j70 && {
      userId: users.tech1 as string,
      lat: j70.lat + 0.0002,
      lng: j70.lng - 0.0001,
      accuracyM: 18,
      source: "ping",
      jobId: j70.jobId,
      recordedAt: minsAgo(2),
    },
    j72 &&
      j73 && {
        userId: users.tech2 as string,
        lat: j72.lat + (j73.lat - j72.lat) * 0.6,
        lng: j72.lng + (j73.lng - j72.lng) * 0.6,
        accuracyM: 140, // shows the accuracy halo (> 100 m)
        heading: 45,
        speed: 13.4,
        source: "ping",
        jobId: j73.jobId,
        recordedAt: minsAgo(1),
      },
    j75 && {
      userId: users.tech3 as string,
      lat: j75.lat,
      lng: j75.lng,
      accuracyM: 25,
      source: "status",
      jobId: j75.jobId,
      recordedAt: minsAgo(19), // > 15 min: shows the grey "stale" marker
    },
  ].filter((r): r is NonNullable<typeof r> => !!r);
  for (const r of rows)
    await db
      .insert(techLocations)
      .values(r)
      .onConflictDoUpdate({ target: techLocations.userId, set: r });
  ctx.log(`map: ${rows.length} tech locations`);
}
