// Demo seed fragment for `time` (BUILD_PLAN §10.3 #8). Owner: B2.
// 60 days of time entries for the three techs (Mon–Sat, ~7:30 → ~17:00 with a
// 30-min lunch, geostamped near the shop), and today's entries left open so the
// techs show as clocked in. Never emits events; idempotent via seedId().
import "server-only";
import type { DB } from "@/db";
import { timeEntries } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { zonedParts } from "@/lib/time";

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const SHOP = ctx.profile.company.shop; // the shop (downtown Austin in the default demo)
  const techs = ctx.plan.users.filter((u) => u.role === "tech");
  const rows: (typeof timeEntries.$inferInsert)[] = [];
  for (const [ti, u] of techs.entries()) {
    for (let d = -60; d <= 0; d++) {
      const day = ctx.at(d, "12:00");
      const weekday = zonedParts(day, ctx.tz).weekday;
      if (weekday === 0) continue; // Sundays off
      // Saturdays: tech3 only (on-call), half day.
      if (weekday === 6 && ti !== 2) continue;
      const inMin = 25 + Math.floor(ctx.rng() * 35) + ti * 5; // 7:25–8:05
      const clockIn = ctx.at(
        d,
        `07:${String(Math.min(59, inMin % 60)).padStart(2, "0")}`,
      );
      const inAt =
        inMin >= 60 ? new Date(clockIn.getTime() + 3600_000) : clockIn;
      const hours = weekday === 6 ? 4.5 : 8.5 + ctx.rng() * 1.5;
      const outAt = new Date(inAt.getTime() + hours * 3600_000);
      const today = d === 0;
      if (today && inAt > ctx.now) continue; // seeded before the day started
      const vehicleId = u.vehicleKey ? seedId("vehicle", u.vehicleKey) : null;
      const j = () => (ctx.rng() - 0.5) * 0.004;
      rows.push({
        id: seedId("time_entry", `${u.key}-${d}`),
        userId: u.id,
        clockInAt: inAt,
        clockOutAt: today ? null : outAt,
        inLat: SHOP.lat + j(),
        inLng: SHOP.lng + j(),
        outLat: today ? null : SHOP.lat + j(),
        outLng: today ? null : SHOP.lng + j(),
        vehicleId,
        breakMinutes: today || weekday === 6 ? 0 : 30,
        source: "app",
        createdAt: inAt,
        updatedAt: today ? inAt : outAt,
      });
    }
  }
  // One admin correction so the audit trail shows up on /time.
  const fix = rows.find((r) => r.userId === techs[1]?.id && r.clockOutAt);
  if (fix) {
    fix.source = "admin_edit";
    fix.editedBy = ctx.plan.users.find((u) => u.key === "admin")?.id ?? null;
    fix.editReason = "Forgot to clock out — set to last job's completion.";
  }
  for (let i = 0; i < rows.length; i += 200)
    await db
      .insert(timeEntries)
      .values(rows.slice(i, i + 200))
      .onConflictDoNothing();
  ctx.log(`time: ${rows.length} entries`);
}
