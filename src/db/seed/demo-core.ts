import "server-only";
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { company, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { normalizeHex } from "@/lib/branding";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/flags";
import type { DemoSeedCtx } from "./types";

// Demo fragment 1 (F, BUILD_PLAN §10.3): company profile + settings (every feature on)
// and the five demo users (the profile's password — demo1234 for the default demo — hashed
// directly, bypassing the signup policy).
export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const p = ctx.plan;
  const prof = ctx.profile.company;
  const features = Object.fromEntries(
    Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => [k, true]),
  );
  const accent = normalizeHex(prof.accent);
  const settings = {
    features,
    company: {
      service_zips: p.company.serviceZips,
      emergency_phone: prof.emergencyPhone,
      lead_response_minutes: 10,
      license_numbers: [p.company.license],
      trade_preset: "generic",
    },
    reviews: { google_url: prof.googleReviewUrl },
    // Trade profiles carry a brand accent; the default demo keeps the system blue.
    ...(accent ? { branding: { accent_color: accent } } : {}),
  };
  await db
    .insert(company)
    .values({
      id: 1,
      name: p.company.name,
      legalName: p.company.legalName,
      phone: p.company.phone,
      email: p.company.email,
      website: p.company.website,
      address: p.company.address,
      timezone: p.company.timezone,
      state: p.company.state,
      settings,
    })
    .onConflictDoUpdate({
      target: company.id,
      set: {
        name: p.company.name,
        legalName: p.company.legalName,
        phone: p.company.phone,
        email: p.company.email,
        website: p.company.website,
        address: p.company.address,
        timezone: p.company.timezone,
        state: p.company.state,
        settings: sql`${company.settings} || ${JSON.stringify(settings)}::jsonb`,
        updatedAt: ctx.now,
      },
    });

  const passwordHash = await hashPassword(p.password);
  const created = new Date(ctx.now.getTime() - 90 * 86_400_000);
  await db
    .insert(users)
    .values(
      p.users.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        name: u.name,
        role: u.role,
        status: "active",
        passwordHash,
        color: u.color,
        workerType: u.workerType,
        compPlanKey: u.planKey,
        usesCompanyTools: true,
        usesCompanyVehicle: u.vehicleKey !== "v3",
        monitoringNoticeAckAt: u.role === "tech" ? created : null,
        esignConsentAt: created,
        hireDate: "2025-06-01",
        createdAt: created,
        updatedAt: created,
      })),
    )
    .onConflictDoNothing();
  ctx.log(`company + ${p.users.length} users`);
}
