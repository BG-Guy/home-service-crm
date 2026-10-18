// Demo seed fragment for `media` (BUILD_PLAN §10.3 #11). Owner: B4.
// Job photos (before / after / problem) through F's seedPlaceholderMedia: geostamped near
// the property, captured on the visit, some starred for the invoice, evidence-locked
// where the job was invoiced. Never emits events; reruns are no-ops (fixed ids).
import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { jobs, media } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";

const COLORS = { before: "#8E8E93", after: "#30B0C7", problem: "#FF8D28" };

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const plan = ctx.plan;
  const props = new Map<string, { lat: number; lng: number }>();
  for (const c of plan.customers)
    for (const p of c.properties) props.set(p.id, { lat: p.lat, lng: p.lng });
  const userId = (k: string | null) =>
    plan.users.find((u) => u.key === k)?.id ?? null;
  const wanted = plan.jobs.filter(
    (j) => j.photos.before + j.photos.after + j.photos.problem > 0,
  );
  // Guard: B2's jobs fragment may not have run (parallel build): skip missing jobs.
  const present = new Set(
    (
      await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          inArray(
            jobs.id,
            wanted.map((j) => j.id),
          ),
        )
    ).map((r) => r.id),
  );
  let n = 0;
  for (const j of wanted) {
    if (!present.has(j.id) || j.dayOffset == null) continue;
    const site = props.get(j.propertyId);
    const [h = 9, m = 0] = (j.windowStart ?? "09:00").split(":").map(Number);
    const start = ctx.at(
      j.dayOffset,
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    );
    const jitter = () => (ctx.rng() - 0.5) * 0.0004; // ≈ ±20 m
    const star = j.n % 4 === 0;
    const make = async (
      tag: "before" | "after" | "problem",
      k: number,
      minutes: number,
    ) => {
      const id = seedId("media", `j${j.n}-${tag}-${k}`);
      await seedPlaceholderMedia(db, {
        id,
        kind: "photo",
        tag,
        jobId: j.id,
        customerId: j.customerId,
        uploaderId: userId(j.tech),
        label: `${tag === "before" ? "Before" : tag === "after" ? "After" : "Problem"} ${k} · ${j.number}`,
        color: COLORS[tag],
        // T3-19: never in the future for jobs later today.
        capturedAt: new Date(
          Math.min(
            start.getTime() + minutes * 60_000,
            ctx.now.getTime() - 5 * 60_000,
          ),
        ),
        geo: site
          ? {
              lat: site.lat + jitter(),
              lng: site.lng + jitter(),
              accuracyM: 8 + Math.round(ctx.rng() * 20),
            }
          : null,
        includeInInvoice: star && k === 1 && tag !== "problem",
        evidenceLocked: j.invoiced && tag !== "problem",
        caption:
          tag === "problem"
            ? j.cancelledAfterArrival
              ? "Customer not home, gate locked"
              : "Damage found on arrival"
            : null,
      });
      n++;
      return id;
    };
    for (let k = 1; k <= j.photos.problem; k++) await make("problem", k, 4);
    for (let k = 1; k <= j.photos.before; k++) await make("before", k, 6 + k);
    for (let k = 1; k <= j.photos.after; k++)
      await make("after", k, 80 + k * 3);
  }
  // A couple of realistic flags for the gallery and the evidence pack.
  const flagged = plan.jobs.find(
    (j) => j.photos.before > 0 && j.n > 20 && present.has(j.id),
  );
  if (flagged)
    await db
      .update(media)
      .set({ flags: ["possibly_from_library"] })
      .where(eq(media.id, seedId("media", `j${flagged.n}-before-2`)));
  ctx.log(`media: ${n} job photos`);
}
