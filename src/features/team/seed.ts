// Demo seed fragment for `team` (BUILD_PLAN §10.3 #2). Owner: B8.
// Fills the profile columns of F's five demo users (licenses, skills, service ZIPs,
// home base), the plan's permission overrides (tech1 vehicles.log_trusted) and
// Jordan Blake's pending invite (via F createInvite, as the plan requires).
// Writes only B8 tables/columns; rerunnable.
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { invites, userPermissionOverrides, users } from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createInvite } from "@/features/auth/api";
import type { Actor } from "@/lib/types";

const st = (k: string) => seedId("service_type", k);

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const p = ctx.plan;
  // Licenses, skills, service ZIPs and home bases come from the trade profile.
  const PROFILES = ctx.profile.team.members;
  const admin = p.users.find((u) => u.key === "admin");
  const now = ctx.now;
  let profiles = 0;
  for (const u of p.users) {
    const prof = PROFILES[u.key];
    if (!prof) continue;
    const [lo, hi] = prof.zips ?? [0, -1];
    const zips = Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
    await db
      .update(users)
      .set({
        licenseNumbers: prof.licenses ?? [],
        skills: (prof.skills ?? []).map(st),
        serviceZips: zips,
        homeBase: prof.home ?? null,
        hireDate: prof.hireDate ?? null,
        lastLoginAt: new Date(
          now.getTime() - (u.role === "tech" ? 2 : 20) * 3600_000,
        ),
        updatedAt: now,
      })
      .where(eq(users.id, u.id));
    profiles++;
    for (const o of u.permOverrides) {
      await db
        .insert(userPermissionOverrides)
        .values({
          userId: u.id,
          perm: o.perm,
          effect: o.effect,
          reason: "Trusted logger: 2+ years, no corrections",
          createdBy: admin?.id ?? null,
          createdAt: new Date(now.getTime() - 30 * 86_400_000),
        })
        .onConflictDoNothing();
    }
  }

  // Pending invite (rerun-safe: skip when one is already open for this email).
  const inv = p.pendingInvite;
  const [open] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, inv.email),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
      ),
    )
    .limit(1);
  if (!open && admin) {
    const actor: Actor = { kind: "user", userId: admin.id };
    await createInvite(
      db,
      {
        name: inv.name,
        email: inv.email,
        phone: ctx.profile.pendingInvite.phone,
        role: inv.role,
        workerType: inv.workerType,
      },
      actor,
      { emit: false },
    );
  }
  ctx.log(`team: ${profiles} profiles, invite for ${inv.name}`);
}
