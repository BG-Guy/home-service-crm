import { describe, expect, it } from "vitest";
import { modules } from "@/features/registry";
import { DEFAULT_FEATURE_FLAGS } from "@/lib/flags";
import { buildNav, navForUser } from "@/lib/nav";
import {
  ALL_PERMS,
  checkOverrideChange,
  checkRoleGridChange,
  DEFAULT_GRANTS,
  effective,
  PERMISSION_TABLE,
  type Perm,
  type PermSubject,
  resolvePerms,
} from "@/lib/permissions";

// Golden: the complete SPEC §4.2 table (key → A/O/T default grants), transcribed
// verbatim. Any change to permission keys or defaults must update this table.
const SPEC_4_2: [string, string][] = [
  ["audit.view", "A"],
  ["automations.manage", "A"],
  ["cash.receive", "AO"],
  ["cash.remit_own", "AOT"],
  ["comp_plans.manage", "A"],
  ["custom_fields.manage", "A"],
  ["customers.contact_view", "AO"],
  ["customers.create", "AOT"],
  ["customers.delete", "A"],
  ["customers.edit", "AO"],
  ["customers.export", "A"],
  ["customers.flags_manage", "AO"],
  ["customers.merge", "AO"],
  ["customers.view", "AOT"],
  ["customers.view_all", "AO"],
  ["data.export", "A"],
  ["data.import", "A"],
  ["deposits.waive", "AO"],
  ["disputes.manage", "A"],
  ["disputes.view", "AO"],
  ["estimates.approve_on_behalf", "AO"],
  ["estimates.create", "AOT"],
  ["estimates.discount", "AOT"],
  ["estimates.send", "AOT"],
  ["estimates.view", "AOT"],
  ["evidence.view", "AO"],
  ["insights.view_financials", "A"],
  ["insights.view_ops", "AO"],
  ["insights.view_own", "AOT"],
  ["insights.view_team", "AO"],
  ["inventory.manage", "AO"],
  ["inventory.request_restock", "AOT"],
  ["inventory.view", "AOT"],
  ["invoices.create", "AOT"],
  ["invoices.revise", "AO"],
  ["invoices.view", "AOT"],
  ["invoices.void", "A"],
  ["jobs.approve_start", "A"],
  ["jobs.assign", "AO"],
  ["jobs.cancel", "AO"],
  ["jobs.cancel_after_arrival", "AT"],
  ["jobs.create", "AOT"],
  ["jobs.edit", "AO"],
  ["jobs.override_requirements", "A"],
  ["jobs.reopen", "A"],
  ["jobs.reschedule", "AO"],
  ["jobs.review_cancellations", "A"],
  ["jobs.set_custom_rate", "A"],
  ["jobs.status_any", "AO"],
  ["jobs.status_own", "AOT"],
  ["jobs.view_all", "AO"],
  ["jobs.view_financials", "A"],
  ["jobs.view_own", "AOT"],
  ["leads.convert", "AO"],
  ["leads.create", "AOT"],
  ["leads.edit", "AO"],
  ["leads.receive_alerts", "AO"],
  ["leads.view", "AO"],
  ["location.share", "T"],
  ["map.view", "AO"],
  ["messages.bulk_send", "A"],
  ["messages.outbox_all", "AO"],
  ["messages.send", "AOT"],
  ["messages.view_all", "AO"],
  ["parts.add_to_job", "AOT"],
  ["parts.approve_reimbursement", "A"],
  ["parts.submit_receipt", "AOT"],
  ["parts.view_cost", "AOT"],
  ["payments.collect", "AOT"],
  ["payments.keyed_entry", "AO"],
  ["payments.record_manual", "AOT"],
  ["payments.refund", "A"],
  ["payments.verify_manual", "AO"],
  ["payments.view_all", "AO"],
  ["payroll.approve", "A"],
  ["payroll.bank_edit_own", "AOT"],
  ["payroll.manage", "A"],
  ["payroll.payout", "A"],
  ["payroll.view_all", "A"],
  ["payroll.view_own", "AOT"],
  ["photos.delete", "A"],
  ["photos.upload", "AOT"],
  ["pricebook.manage", "AO"],
  ["reminders.manage", "AO"],
  ["reports.export", "A"],
  ["reviews.send_manual", "AO"],
  ["reviews.view", "AOT"],
  ["schedule.view_all", "AO"],
  ["settings.api_keys", "A"],
  ["settings.features", "A"],
  ["settings.integrations", "A"],
  ["settings.manage", "A"],
  ["settings.permissions", "A"],
  ["tags.manage", "AO"],
  ["tasks.view_all", "AO"],
  ["templates.manage", "AO"],
  ["time.clock_self", "AOT"],
  ["time.manage", "A"],
  ["tools.audit_review", "A"],
  ["tools.audit_submit", "AOT"],
  ["tools.maintenance_log", "AOT"],
  ["tools.manage", "A"],
  ["tools.report_incident", "AOT"],
  ["tools.view_all", "AO"],
  ["tools.view_own", "AOT"],
  ["users.invite", "A"],
  ["users.manage", "A"],
  ["vehicles.log", "AOT"],
  ["vehicles.log_approve", "A"],
  ["vehicles.log_trusted", ""],
  ["vehicles.manage", "A"],
  ["vehicles.report_issue", "AOT"],
  ["vehicles.view_all", "AO"],
  ["vehicles.view_own", "AOT"],
];

const admin: PermSubject = { role: "admin", baseRole: "admin" };
const office: PermSubject = { role: "office", baseRole: "office" };
const tech: PermSubject = { role: "tech", baseRole: "tech" };

describe("permission catalog (SPEC §4.2)", () => {
  it("has exactly the spec keys", () => {
    expect([...ALL_PERMS].sort()).toEqual(SPEC_4_2.map(([k]) => k).sort());
    expect(ALL_PERMS).toHaveLength(114);
  });

  it("default grants match the spec table for every role", () => {
    for (const [key, letters] of SPEC_4_2) {
      const p = key as Perm;
      expect(PERMISSION_TABLE[p], key).toBe(letters);
      expect(DEFAULT_GRANTS.admin.has(p), `${key} admin`).toBe(
        letters.includes("A"),
      );
      expect(DEFAULT_GRANTS.office.has(p), `${key} office`).toBe(
        letters.includes("O"),
      );
      expect(DEFAULT_GRANTS.tech.has(p), `${key} tech`).toBe(
        letters.includes("T"),
      );
    }
  });

  it("every manifest's permissions are part of the union and no key is declared twice", () => {
    const declared = modules.flatMap((m) => m.permissions);
    expect(new Set(declared).size).toBe(declared.length);
    expect(new Set(declared)).toEqual(new Set(ALL_PERMS));
  });
});

describe("resolver: override → role grid → DEFAULT_GRANTS (SPEC §4.1)", () => {
  it("falls back to code defaults", () => {
    expect(effective(tech, "jobs.view_own")).toBe(true);
    expect(effective(tech, "jobs.view_all")).toBe(false);
    expect(effective(office, "payments.refund")).toBe(false);
    expect(effective(admin, "payments.refund")).toBe(true);
    expect(effective(tech, "location.share")).toBe(true);
    expect(effective(admin, "location.share")).toBe(false);
  });

  it("role grid beats defaults", () => {
    expect(
      effective(
        { ...office, roleGrid: { "payments.refund": true } },
        "payments.refund",
      ),
    ).toBe(true);
    expect(
      effective(
        { ...tech, roleGrid: { "jobs.view_own": false } },
        "jobs.view_own",
      ),
    ).toBe(false);
  });

  it("user override beats the role grid (allow and deny)", () => {
    expect(
      effective(
        {
          ...tech,
          roleGrid: { "jobs.view_all": false },
          overrides: { "jobs.view_all": "allow" },
        },
        "jobs.view_all",
      ),
    ).toBe(true);
    expect(
      effective(
        {
          ...office,
          roleGrid: { "leads.view": true },
          overrides: { "leads.view": "deny" },
        },
        "leads.view",
      ),
    ).toBe(false);
  });

  it("vehicles.log_trusted is nobody's default but grantable per user", () => {
    expect(effective(admin, "vehicles.log_trusted")).toBe(false);
    expect(
      effective(
        { ...tech, overrides: { "vehicles.log_trusted": "allow" } },
        "vehicles.log_trusted",
      ),
    ).toBe(true);
  });

  it("custom roles inherit their base role defaults", () => {
    const dispatcher: PermSubject = { role: "dispatcher", baseRole: "office" };
    expect(effective(dispatcher, "jobs.assign")).toBe(true);
    expect(effective(dispatcher, "payroll.manage")).toBe(false);
  });

  it("locks: admins always keep settings.permissions and users.manage", () => {
    const denied: PermSubject = {
      ...admin,
      roleGrid: { "settings.permissions": false, "users.manage": false },
      overrides: { "settings.permissions": "deny", "users.manage": "deny" },
    };
    expect(effective(denied, "settings.permissions")).toBe(true);
    expect(effective(denied, "users.manage")).toBe(true);
    expect(checkRoleGridChange("admin", "users.manage", false).ok).toBe(false);
    expect(checkRoleGridChange("office", "users.manage", true).ok).toBe(true);
    expect(
      checkOverrideChange("admin", "settings.permissions", "deny").ok,
    ).toBe(false);
  });

  it("locks: an override can't grant settings.permissions to a non-admin", () => {
    expect(
      effective(
        { ...office, overrides: { "settings.permissions": "allow" } },
        "settings.permissions",
      ),
    ).toBe(false);
    expect(
      checkOverrideChange("office", "settings.permissions", "allow").ok,
    ).toBe(false);
    // …other admin perms can be granted by override
    expect(
      effective(
        { ...office, overrides: { "payments.refund": "allow" } },
        "payments.refund",
      ),
    ).toBe(true);
  });

  it("resolvePerms returns the full effective set", () => {
    const set = resolvePerms(tech);
    expect(set.has("photos.upload")).toBe(true);
    expect(set.has("photos.delete")).toBe(false);
    expect(set.size).toBe(DEFAULT_GRANTS.tech.size);
  });
});

describe("feature flags + registry (SPEC §5, §15.1)", () => {
  it("registers all 24 modules in spec order", () => {
    expect(modules.map((m) => m.key)).toEqual([
      "auth",
      "team",
      "customers",
      "leads",
      "jobs",
      "tech",
      "estimates",
      "invoices",
      "payments",
      "disputes",
      "media",
      "messaging",
      "automations",
      "reviews",
      "parts",
      "payroll",
      "vehicles",
      "tools",
      "map",
      "insights",
      "settings",
      "notify",
      "portal",
      "data",
    ]);
  });

  it("flag defaults follow the §5 table", () => {
    expect(DEFAULT_FEATURE_FLAGS).toEqual({
      leads: true,
      estimates: true,
      deposits: true,
      chargeback_protection: true,
      photos: true,
      before_after: true,
      reviews: true,
      parts: true,
      inventory: false,
      payroll: true,
      vehicles: true,
      tools: false,
      map: true,
    });
  });
});

const viewer = (s: PermSubject) => ({
  baseRole: s.baseRole,
  perms: resolvePerms(s),
});
const allOn = { ...DEFAULT_FEATURE_FLAGS, tools: true, inventory: true };

describe("navigation (SPEC §13)", () => {
  it("tech tab bar: Today, Jobs (mine), Inbox, Pay", () => {
    const nav = navForUser(viewer(tech), allOn);
    expect(nav.tabs.map((t) => [t.label, t.href])).toEqual([
      ["Today", "/today"],
      ["Jobs", "/jobs?mine=1"],
      ["Inbox", "/messages/outbox"],
      ["Pay", "/pay"],
    ]);
  });

  it("office tab bar: Today, Schedule, Leads, Customers", () => {
    const nav = navForUser(viewer(office), allOn);
    expect(nav.tabs.map((t) => t.label)).toEqual([
      "Today",
      "Schedule",
      "Leads",
      "Customers",
    ]);
  });

  it("admin tab bar: Home (/insights), Schedule, Customers, Money (/payments)", () => {
    const nav = navForUser(viewer(admin), allOn);
    expect(nav.tabs.map((t) => [t.label, t.href])).toEqual([
      ["Home", "/insights"],
      ["Schedule", "/schedule"],
      ["Customers", "/customers"],
      ["Money", "/payments"],
    ]);
  });

  it("hides items whose flag is off or whose permission is missing", () => {
    const off = navForUser(viewer(office), { ...allOn, leads: false });
    expect(off.tabs.map((t) => t.label)).toEqual([
      "Today",
      "Schedule",
      "Customers",
    ]);
    const techNav = navForUser(viewer(tech), allOn);
    const techMore = techNav.more.flatMap((g) => g.items.map((i) => i.key));
    expect(techMore).not.toContain("settings");
    expect(techMore).not.toContain("approvals");
    expect(techMore).toContain("vehicles");
    const noTools = navForUser(viewer(tech), DEFAULT_FEATURE_FLAGS);
    expect(
      noTools.more.flatMap((g) => g.items.map((i) => i.key)),
    ).not.toContain("tools");
  });

  it("More omits items already shown as tabs and keeps account rows", () => {
    const nav = navForUser(viewer(office), allOn);
    const keys = nav.more.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).not.toContain("leads");
    expect(keys).toEqual(
      expect.arrayContaining([
        "notifications",
        "settings.profile",
        "account.signout",
      ]),
    );
    const adminMore = navForUser(viewer(admin), allOn).more.flatMap((g) =>
      g.items.map((i) => i.key),
    );
    expect(adminMore).toContain("leads"); // "Leads (admin)" lives in More for admins
  });

  it("desktop sidebar sections and the settings index", () => {
    const nav = navForUser(viewer(admin), allOn);
    expect(nav.sidebar.map((s) => s.key)).toEqual([
      "overview",
      "work",
      "customers",
      "money",
      "operations",
      "settings",
    ]);
    const work = nav.sidebar
      .find((s) => s.key === "work")
      ?.items.map((i) => i.label);
    expect(work).toEqual([
      "Schedule",
      "Assign",
      "Leads",
      "Jobs",
      "Estimates",
      "Invoices",
      "Tasks",
    ]);
    // The Assign hub is office/admin only (jobs.assign) and in the phone More list.
    const officeNav = navForUser(viewer(office), allOn);
    expect(officeNav.more.flatMap((g) => g.items.map((i) => i.key))).toContain(
      "dispatch",
    );
    const techNav = navForUser(viewer(tech), allOn);
    const techKeys = [
      ...techNav.sidebar.flatMap((s) => s.items.map((i) => i.key)),
      ...techNav.more.flatMap((g) => g.items.map((i) => i.key)),
    ];
    expect(techKeys).not.toContain("dispatch");
    // Time clock sits in Operations next to Team (QA T3-22).
    const operations = nav.sidebar
      .find((s) => s.key === "operations")
      ?.items.map((i) => i.label);
    expect(operations).toEqual(expect.arrayContaining(["Team", "Time clock"]));
    expect(operations?.indexOf("Time clock")).toBe(
      (operations?.indexOf("Team") ?? -2) + 1,
    );
    const settingsHrefs = nav.settings.flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(settingsHrefs).toEqual(
      expect.arrayContaining([
        "/settings/company",
        "/settings/permissions",
        "/settings/pricebook",
        "/settings/audit",
      ]),
    );
    expect(settingsHrefs).not.toContain("/settings");
    const officeSettings = navForUser(viewer(office), allOn).settings.flatMap(
      (g) => g.items.map((i) => i.href),
    );
    expect(officeSettings).not.toContain("/settings/permissions");
    expect(officeSettings).toContain("/settings/templates");
  });

  it("buildNav caps the tab bar at four items", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      key: `k${i}`,
      href: `/k${i}`,
      label: `K${i}`,
      icon: "jobs",
      tabPriority: { tech: i + 1 },
    }));
    expect(buildNav(items, viewer(tech), allOn).tabs).toHaveLength(4);
  });
});
