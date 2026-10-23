import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GENERIC_SERVICE_TYPES,
  RETIRED_SERVICE_TYPE_KEYS,
} from "@/db/seed/base";
import { buildPlan, DEMO, totalsOf } from "@/db/seed/demo-plan";
import {
  DEMO_PROFILE_KEYS,
  DEMO_PROFILES,
  resolveDemoProfile,
} from "@/db/seed/profiles";
import type { DemoProfile } from "@/db/seed/profiles/types";
import { isJobKind } from "@/features/jobs/kinds";
import { SERVICE_ICONS } from "@/features/settings/options";
import { brandTokens } from "@/lib/branding";

// Trade demo profiles (npm run seed:demo -- --profile=<key>): every profile must build
// a plan with the same shape as the default demo, with sane money and no copy leaking
// in from another trade.

const TRADES = ["handyman", "locksmith", "chimney"] as const;
const DOMAINS: Record<(typeof TRADES)[number], string> = {
  handyman: "brightside.test",
  locksmith: "ironclad.test",
  chimney: "emberflue.test",
};

/** Every string a profile carries (functions sampled), for leak checks. */
function profileText(p: DemoProfile): string {
  return JSON.stringify(p, (_k, v) =>
    typeof v === "function" ? String(v(1)) : v,
  );
}

describe("default demo plan", () => {
  it("is the plan of the default profile and has not changed", () => {
    const plan = buildPlan(resolveDemoProfile(undefined));
    expect(plan).toEqual(DEMO);
    // Pins the mixed demo the other tests rely on (job numbers, names, amounts). If
    // you change it on purpose, update this hash with the new one.
    const sha = createHash("sha1").update(JSON.stringify(plan)).digest("hex");
    // Assign hub: J89 / J90 gained a booked window today / tomorrow (still
    // unscheduled, no tech) so /dispatch has a job to recommend for.
    // Job types redesign (leads-flow item 6): recipes moved off the retired Repair /
    // Maintenance types onto the trade's jobs (Lockout, Rekey, Garage door repair,
    // Plumbing…) and the generic Service call / Project; J12, J67 and J69 take their
    // type from the profile (J69 "Lockout + new lock" is a Lockout, with the ⚖️ ownership
    // check). Service type keys only: same jobs, money and story.
    expect(sha).toBe("722f59098d43db92043a8bbee231c673a7dbacaf");
  });

  it("rejects unknown profile keys", () => {
    expect(DEMO_PROFILE_KEYS).toEqual([
      "default",
      "handyman",
      "locksmith",
      "chimney",
    ]);
    expect(resolveDemoProfile("").key).toBe("default");
    expect(() => resolveDemoProfile("plumber")).toThrow(/Unknown demo profile/);
  });
});

describe.each(TRADES)("%s profile", (key) => {
  const profile = DEMO_PROFILES[key] as DemoProfile;
  const plan = buildPlan(profile);
  const pb = new Map(plan.pricebook.map((p) => [p.key, p]));
  const toolKeys = new Set(plan.tools.map((t) => t.key));

  it("builds a plan with the default demo's shape", () => {
    expect(plan.users.map((u) => [u.key, u.role])).toEqual(
      DEMO.users.map((u) => [u.key, u.role]),
    );
    expect(plan.customers).toHaveLength(DEMO.customers.length);
    expect(plan.jobs).toHaveLength(DEMO.jobs.length);
    expect(plan.leads).toHaveLength(DEMO.leads.length);
    expect(plan.estimates).toHaveLength(DEMO.estimates.length);
    expect(
      plan.vehicles.map((v) => [v.key, v.ownership, v.assignedTo]),
    ).toEqual(DEMO.vehicles.map((v) => [v.key, v.ownership, v.assignedTo]));
    expect(plan.tools).toHaveLength(DEMO.tools.length);
    expect(toolKeys.size).toBe(plan.tools.length);
    // Same statuses per job number (the story: today's board, AR, holds, cancels…).
    expect(plan.jobs.map((j) => j.status)).toEqual(
      DEMO.jobs.map((j) => j.status),
    );
    expect(plan.jobs.filter((j) => j.deposit).map((j) => j.n)).toEqual(
      DEMO.jobs.filter((j) => j.deposit).map((j) => j.n),
    );
    expect(plan.jobs.find((j) => j.n === 12)?.dispute).toBeTruthy();
    expect(plan.jobs.filter((j) => j.refund).map((j) => j.n)).toEqual([25, 33]);
  });

  it("uses the business's logins, domain and password", () => {
    const domain = DOMAINS[key];
    expect(plan.password).toBe("TestDrive2026!");
    expect(plan.users.map((u) => u.email)).toEqual(
      ["admin", "office", "tech1", "tech2", "tech3"].map(
        (k) => `${k}@${domain}`,
      ),
    );
    expect(new Set(plan.users.map((u) => u.name)).size).toBe(5);
    expect(plan.company.email.endsWith(`@${domain}`)).toBe(true);
  });

  it("keeps the plan totals authoritative", () => {
    for (const j of plan.jobs) {
      expect(j.totals).toEqual(totalsOf(j.lines, plan.taxBps));
      for (const l of j.lines)
        if (l.type !== "discount")
          expect(l.totalCents).toBe(Math.round(l.qty * l.unitPriceCents));
      const paid = j.payments.reduce((a, p) => a + p.amountCents, 0);
      if (j.paymentStatus === "paid" || j.paymentStatus === "disputed")
        expect(paid).toBe(j.totals.totalCents);
      if (j.paymentStatus === "deposit_paid") {
        expect(paid).toBe(j.deposit?.amountCents);
        expect(paid).toBeLessThan(j.totals.totalCents);
      }
      if (j.refund)
        expect(j.refund.amountCents).toBeLessThan(
          j.payments.find((p) => p.kind === "payment")?.amountCents ?? 0,
        );
      for (const p of j.payments) expect(p.amountCents).toBeGreaterThan(0);
    }
    for (const e of plan.estimates)
      expect(e.totals).toEqual(totalsOf(e.lines, plan.taxBps));
    // Deposits land on the bigger tickets.
    const median = [...plan.jobs.map((j) => j.totals.totalCents)].sort(
      (a, b) => a - b,
    )[45] as number;
    for (const n of [10, 20, 40, 50])
      expect(plan.jobs[n - 1]?.totals.totalCents).toBeGreaterThan(median);
  });

  it("resolves every recipe line to a price-book item", () => {
    const keys = [
      ...profile.partScenarios.flatMap((s) => s.lines.map(([k]) => k)),
      ...profile.laborScenarios.flatMap((s) => s.lines.map(([k]) => k)),
      ...profile.specialJobs.dispute.lines.map(([k]) => k),
      ...profile.specialJobs.specialOrder.lines.map(([k]) => k),
      ...profile.specialJobs.todayCash.lines.map(([k]) => k),
      ...Object.values(profile.standaloneEstimates).flatMap((ls) =>
        ls.map(([k]) => k),
      ),
      ...profile.estimates.addons.map((a) => a.key),
      profile.estimates.bestUpgrade.pricebookKey,
      ...profile.parts.stockItems,
      "service_call",
      "after_hours",
      "trip_fee",
      "cancel_fee",
    ];
    for (const k of keys) expect(pb.has(k), `price book key ${k}`).toBe(true);
    for (const j of plan.jobs)
      for (const l of j.lines)
        if (l.type !== "discount") expect(pb.has(l.pricebookKey)).toBe(true);
    // Recipes looked up by key, and service types that exist.
    const scenarioKeys = new Set(
      [...profile.partScenarios, ...profile.laborScenarios].map((s) => s.key),
    );
    const sj = profile.specialJobs;
    for (const k of [
      sj.awaitingApproval.scenario,
      sj.todayCard.scenario,
      sj.recurring.scenario,
    ])
      expect(scenarioKeys.has(k)).toBe(true);
    const serviceTypes = new Set<string>([
      ...GENERIC_SERVICE_TYPES.map((s) => s.key),
      ...profile.settings.tradeJobs.map((t) => t.key),
      profile.settings.extraServiceType.key,
    ]);
    for (const j of plan.jobs)
      expect(serviceTypes.has(j.serviceTypeKey)).toBe(true);
    for (const m of Object.values(profile.team.members))
      for (const s of m.skills ?? []) expect(serviceTypes.has(s)).toBe(true);
  });

  it("puts the trade's jobs under the three job types", () => {
    const { tradeJobs, extraServiceType } = profile.settings;
    const all = [...tradeJobs, extraServiceType];
    const keys = all.map((t) => t.key);
    const generic = GENERIC_SERVICE_TYPES.map((s) => s.key as string);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(generic).not.toContain(k);
    const names = [
      ...GENERIC_SERVICE_TYPES.map((s) => s.name),
      ...all.map((t) => t.name),
    ];
    expect(new Set(names).size).toBe(names.length);
    const icons = new Set<string>(SERVICE_ICONS.map((i) => i.value));
    for (const t of all) {
      expect(isJobKind(t.kind), t.key).toBe(true);
      expect(icons.has(t.icon), `${t.key} icon ${t.icon}`).toBe(true);
      expect(t.defaultDurationMin).toBeGreaterThan(0);
      if (t.kind === "project") expect(t.contractKind).toBe("improvement");
    }
    expect(
      tradeJobs.filter((t) => t.kind === "service").length,
    ).toBeGreaterThan(2);
    expect(tradeJobs.some((t) => t.kind === "project")).toBe(true);
    // Retired generic types are never booked in a fresh demo.
    const retired = new Set<string>(RETIRED_SERVICE_TYPE_KEYS);
    for (const j of plan.jobs)
      expect(retired.has(j.serviceTypeKey)).toBe(false);
    for (const m of Object.values(profile.team.members))
      for (const s of m.skills ?? []) expect(retired.has(s)).toBe(false);
    // Every booked job has a tech with the skill (booking availability needs one).
    const techs = Object.entries(profile.team.members).filter(([k]) =>
      k.startsWith("tech"),
    );
    for (const k of keys)
      expect(
        techs.some(([, m]) => (m.skills ?? []).includes(k)),
        `a tech can do ${k}`,
      ).toBe(true);
  });

  if (key === "locksmith")
    it("⚖️ keeps the proof-of-ownership check on lockouts", () => {
      const { tradeJobs, extraServiceType: x } = profile.settings;
      expect(x).toMatchObject({
        key: "after_hours_lockout",
        name: "After-hours lockout",
        kind: "service",
        requiresOwnershipCheck: true,
      });
      expect(x.checklist.items.map((i) => [i.id, i.required])).toEqual([
        ["id_photo", true],
        ["address_proof", true],
        ["authority_sig", true],
        ["relationship", true],
      ]);
      for (const k of ["lockout", "car_key", "safe"])
        expect(
          tradeJobs.find((t) => t.key === k)?.requiresOwnershipCheck,
          k,
        ).toBe(true);
      // Every lockout recipe lands on a type with the check.
      const own = new Set([
        x.key,
        ...tradeJobs.filter((t) => t.requiresOwnershipCheck).map((t) => t.key),
      ]);
      for (const j of plan.jobs)
        if (/lockout/i.test(j.title))
          expect(own.has(j.serviceTypeKey), j.title).toBe(true);
    });

  it("prices parts above cost and has the items the story needs", () => {
    for (const p of plan.pricebook) {
      expect(p.unitPriceCents).toBeGreaterThan(0);
      if (p.kind === "part" || p.kind === "material") {
        expect(p.unitCostCents).not.toBeNull();
        expect(p.unitCostCents as number).toBeLessThan(p.unitPriceCents);
      }
    }
    const special = plan.pricebook.filter((p) => p.isSpecialOrder);
    expect(special).toHaveLength(1);
    expect(
      profile.specialJobs.specialOrder.lines.some(
        ([k]) => k === special[0]?.key,
      ),
    ).toBe(true);
    for (const k of ["after_hours", "trip_fee", "cancel_fee"])
      expect(pb.get(k)?.kind).toBe("fee");
    // Stock: low items restock to 9 (so they can't be big-ticket items).
    for (const k of profile.parts.lowItems) {
      expect(profile.parts.stockItems).toContain(k);
      expect(profile.parts.bigItems).not.toContain(k);
    }
    for (const k of profile.parts.stockItems)
      expect(["part", "material"]).toContain(pb.get(k)?.kind);
  });

  it("wires the tools fragment to real tool keys", () => {
    const t = profile.tooling;
    for (const k of [
      ...t.kit.tools,
      t.missing.key,
      t.maintenanceLog.key,
      ...Object.keys(t.maintenance),
    ])
      expect(toolKeys.has(k), `tool ${k}`).toBe(true);
    expect(plan.tools.find((x) => x.key === t.missing.key)?.assignedTo).toBe(
      "tech2",
    );
    expect(t.maintenance[t.maintenanceLog.key]).toBeTruthy();
    for (const tool of plan.tools)
      expect(t.categoryColors[tool.category], tool.category).toBeTruthy();
  });

  it("keeps the metro, phones and brand believable", () => {
    const zips = new Set(profile.company.serviceZips);
    for (const c of plan.customers)
      for (const p of c.properties) {
        expect(zips.has(p.zip), `${p.zip} served`).toBe(true);
        expect(Math.abs(p.lat - profile.company.address.lat)).toBeLessThan(0.4);
        expect(Math.abs(p.lng - profile.company.address.lng)).toBeLessThan(0.4);
      }
    expect(zips.has(profile.leads.outOfArea.zip)).toBe(false);
    // Fictional 555-01xx numbers, all distinct.
    const phones = [
      plan.company.phone,
      ...plan.users.map((u) => u.phone),
      ...plan.customers.map((c) => c.phone),
      ...plan.leads.filter((l) => !l.customerN).map((l) => l.phone),
      profile.pendingInvite.phone,
      profile.company.emergencyPhone,
    ];
    for (const ph of phones) expect(ph).toMatch(/^\+1\d{3}5550[1]\d{2}$/);
    expect(new Set(phones).size).toBe(phones.length);
    const tokens = brandTokens(profile.company.accent);
    expect(tokens).not.toBeNull();
    expect(tokens?.onAccent).toBe("#ffffff");
  });

  it("carries no copy from the mixed demo or another trade", () => {
    const text = `${JSON.stringify(plan)}\n${profileText(profile)}`;
    expect(text).not.toMatch(/acme|demo\.test|demo1234/i);
    expect(text).not.toMatch(
      /garage|torsion|\bhvac\b|water heater|thermostat|capacitor|refrigerant|opener/i,
    );
    if (key !== "handyman") expect(text).not.toMatch(/austin|\b787\d\d\b/i);
    if (key === "chimney")
      expect(text).not.toMatch(/rekey|deadbolt|lockout|transponder/i);
    if (key === "locksmith")
      expect(text).not.toMatch(/chimney|flue|gutter|drywall/i);
    if (key === "handyman")
      expect(text).not.toMatch(/rekey|transponder|chimney|flue/i);
  });
});
