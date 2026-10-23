import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import { getSecret } from "@/lib/secrets";
import { findCompany, getSettings } from "@/lib/settings";

// Setup checklist (SPEC M01): a dismissible card on Today (admins) until complete.
// Items are detected from real data where possible; the rest can be ticked by hand
// (stored in settings.company.setup_checklist_done). Items of a module whose feature
// flag is off are left out (QA2 T3-21), so they never link to a hidden page.

export interface SetupItem {
  key: string;
  title: string;
  href: string;
  done: boolean;
  /** Auto-detected from data (no manual tick needed). */
  auto: boolean;
}

export interface SetupChecklist {
  items: SetupItem[];
  done: number;
  total: number;
  dismissed: boolean;
}

export async function getSetupChecklist(
  userId: string,
): Promise<SetupChecklist> {
  const [settings, company, stripe] = await Promise.all([
    getSettings(),
    findCompany(),
    getSecret("STRIPE_SECRET_KEY"),
  ]);
  const [c] = await execRows<{
    priced: number;
    pricebook: number;
    tax: number;
    users: number;
    invites: number;
    comp: number;
    vehicles: number;
    sources: number;
    push: number;
  }>(sql`
    select
      (select count(*)::int from service_types where deleted_at is null and active and default_price_cents is not null) as priced,
      (select count(*)::int from pricebook_items where deleted_at is null and active) as pricebook,
      (select count(*)::int from tax_rates where active and is_default and rate_bps > 0) as tax,
      (select count(*)::int from users where status = 'active') as users,
      (select count(*)::int from invites where revoked_at is null) as invites,
      (select count(*)::int from tech_comp) as comp,
      (select count(*)::int from vehicles) as vehicles,
      (select count(*)::int from lead_sources where public_key is not null) as sources,
      (select count(*)::int from push_subscriptions where user_id = ${userId}) as push
  `);
  const n = (k: keyof NonNullable<typeof c>) => Number(c?.[k] ?? 0);
  const manual = new Set(settings.company.setup_checklist_done);
  const f = settings.features as Record<string, boolean>;
  const item = (
    key: string,
    title: string,
    href: string,
    auto: boolean | null,
    flag?: string,
  ): SetupItem | null =>
    flag && f[flag] === false
      ? null
      : {
          key,
          title,
          href,
          done: !!auto || manual.has(key),
          auto: !!auto,
        };
  const items = [
    item(
      "brand",
      "Logo and brand color",
      "/settings/branding",
      !!(company?.logoMediaId || settings.branding.accent_color),
    ),
    item(
      "hours",
      "Business hours and service area",
      "/settings/company",
      settings.company.service_zips.length > 0,
    ),
    item(
      "services",
      "Job types and prices",
      "/settings/services",
      n("priced") > 0 || n("pricebook") > 0,
    ),
    item("tax", "Tax rate", "/settings/taxes", n("tax") > 0),
    item(
      "payments",
      "Payment methods",
      "/settings/payments",
      !!stripe || process.env.PAYMENTS_DRIVER === "stripe",
    ),
    item(
      "reviews",
      "Google review link",
      "/settings/reviews",
      !!(settings as { reviews?: { google_url?: string | null } }).reviews
        ?.google_url,
      "reviews",
    ),
    item(
      "team",
      "Invite your team",
      "/team",
      n("users") > 1 || n("invites") > 0,
    ),
    item(
      "comp",
      "Commission plan",
      "/settings/commission",
      n("comp") > 0,
      "payroll",
    ),
    item(
      "vehicles",
      "Add vehicles",
      "/vehicles",
      n("vehicles") > 0,
      "vehicles",
    ),
    item(
      "leadform",
      "Lead form snippet",
      "/settings/lead-sources",
      n("sources") > 0,
      "leads",
    ),
    item(
      "install",
      "Install the app and enable push",
      "/settings/profile",
      n("push") > 0,
    ),
    item("modules", "Pick optional modules", "/settings/features", null),
    item(
      "cash",
      "Cash policy for techs",
      "/settings/commission",
      null,
      "payroll",
    ),
  ].filter((i): i is SetupItem => i !== null);
  const done = items.filter((i) => i.done).length;
  return {
    items,
    done,
    total: items.length,
    dismissed: settings.company.setup_checklist_dismissed,
  };
}
