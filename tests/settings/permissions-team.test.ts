// B8 settings + team actions on a throwaway PGlite: permission-grid locks, override
// locks, last-admin rule, deactivation side effects, invites, tags, custom fields,
// and the brand-color contrast report.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b8-settings-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: async (perm?: string | string[]) => {
      if (!auth.user) throw new Error("NEXT_REDIRECT /login");
      for (const p of perm ? (Array.isArray(perm) ? perm : [perm]) : []) {
        if (!auth.user.perms.has(p as never)) {
          const { ForbiddenError } = await import("@/lib/errors");
          throw new ForbiddenError(undefined, p);
        }
      }
      return auth.user;
    },
  };
});

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import { sessions } from "@/db/schema";
import {
  createRoleAction,
  saveCustomFieldAction,
  saveTagAction,
  setRolePermissionAction,
  setUserOverrideAction,
} from "@/features/settings/actions";
import {
  getCustomFieldDefs,
  getEntityTags,
  listTags,
  setEntityTags,
  validateCustomValues,
} from "@/features/settings/api";
import { contrastReport } from "@/features/settings/branding-check";
import {
  changeRoleAction,
  deactivateUserAction,
  inviteUserAction,
  reactivateUserAction,
} from "@/features/team/actions";
import { getUserBriefs, listUsers } from "@/features/team/api";
import { lastAdminBlock } from "@/features/team/rules";
import { loadSessionUser } from "@/lib/auth/current";
import { SYSTEM_ACTOR } from "@/lib/types";

const uid = {
  a: randomUUID(),
  b: randomUUID(),
  o: randomUUID(),
  t: randomUUID(),
};

async function as(id: string) {
  const sid = randomUUID();
  await db.insert(sessions).values({
    id: sid,
    userId: id,
    tokenHash: `h-${sid}`,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  auth.user = await loadSessionUser(id, sid);
  if (!auth.user) throw new Error("no session user");
}

const one = async <T>(q: ReturnType<typeof sql>) =>
  (await execRows<T>(q))[0] as T;

beforeAll(async () => {
  await ensureDb();
  await execRows(
    sql`insert into company (id, name, timezone, state) values (1, 'Perm Co', 'America/Chicago', 'TX') on conflict (id) do nothing`,
  );
  await execRows(sql`insert into users (id, email, name, role, status) values
    (${uid.a}, 'a@p.test', 'Ada Admin', 'admin', 'active'),
    (${uid.b}, 'b@p.test', 'Bo Admin', 'admin', 'active'),
    (${uid.o}, 'o@p.test', 'Olive Office', 'office', 'active'),
    (${uid.t}, 't@p.test', 'Ted Tech', 'tech', 'active')`);
  await as(uid.a);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("permission grid locks (SPEC §4.1)", () => {
  it("admins keep settings.permissions and users.manage", async () => {
    for (const perm of ["settings.permissions", "users.manage"]) {
      const r = await setRolePermissionAction({
        role: "admin",
        perm,
        granted: false,
      });
      expect(r.ok).toBe(false);
    }
  });

  it("a normal change is stored, audited and emits permission.changed", async () => {
    const r = await setRolePermissionAction({
      role: "office",
      perm: "jobs.view_all",
      granted: false,
    });
    expect(r.ok).toBe(true);
    const row = await one<{ granted: boolean }>(
      sql`select granted from role_permissions where role = 'office' and perm = 'jobs.view_all'`,
    );
    expect(row.granted).toBe(false);
    const audit = await one<{ n: number }>(
      sql`select count(*)::int n from audit_log where action = 'perm.changed'`,
    );
    expect(audit.n).toBeGreaterThan(0);
    const ev = await one<{ n: number }>(
      sql`select count(*)::int n from events where type = 'permission.changed'`,
    );
    expect(ev.n).toBeGreaterThan(0);
    // the office user's effective perms follow the grid on the next request
    const sid = randomUUID();
    await db.insert(sessions).values({
      id: sid,
      userId: uid.o,
      tokenHash: `h-${sid}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      (await loadSessionUser(uid.o, sid))?.perms.has("jobs.view_all"),
    ).toBe(false);
  });

  it("unknown permissions are rejected", async () => {
    const r = await setRolePermissionAction({
      role: "office",
      perm: "nope.nope",
      granted: true,
    });
    expect(r.ok).toBe(false);
  });

  it("custom roles start from their base role's defaults", async () => {
    const r = await createRoleAction({
      name: "Dispatcher",
      baseRole: "office",
    });
    expect(r.ok && r.data?.key).toBe("dispatcher");
    const n = await one<{ n: number }>(
      sql`select count(*)::int n from role_permissions where role = 'dispatcher' and granted`,
    );
    expect(n.n).toBeGreaterThan(5);
  });
});

describe("per-user overrides", () => {
  it("can't grant settings.permissions to a non-admin", async () => {
    const r = await setUserOverrideAction({
      userId: uid.o,
      perm: "settings.permissions",
      effect: "allow",
    });
    expect(r.ok).toBe(false);
  });

  it("can't deny an admin their locked permissions, nor yourself Permissions", async () => {
    expect(
      (
        await setUserOverrideAction({
          userId: uid.b,
          perm: "users.manage",
          effect: "deny",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await setUserOverrideAction({
          userId: uid.a,
          perm: "settings.permissions",
          effect: "deny",
        })
      ).ok,
    ).toBe(false);
  });

  it("allow → effective, inherit → removed", async () => {
    expect(
      (
        await setUserOverrideAction({
          userId: uid.t,
          perm: "jobs.view_all",
          effect: "allow",
        })
      ).ok,
    ).toBe(true);
    const sid = randomUUID();
    await db.insert(sessions).values({
      id: sid,
      userId: uid.t,
      tokenHash: `h-${sid}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(
      (await loadSessionUser(uid.t, sid))?.perms.has("jobs.view_all"),
    ).toBe(true);
    expect(
      (
        await setUserOverrideAction({
          userId: uid.t,
          perm: "jobs.view_all",
          effect: "inherit",
        })
      ).ok,
    ).toBe(true);
    const n = await one<{ n: number }>(
      sql`select count(*)::int n from user_permission_overrides where user_id = ${uid.t}`,
    );
    expect(n.n).toBe(0);
  });
});

describe("team: last admin, deactivate, invite", () => {
  it("lastAdminBlock (pure)", () => {
    expect(
      lastAdminBlock({
        targetIsActiveAdmin: true,
        otherActiveAdmins: 0,
        nextIsAdmin: false,
      }),
    ).toMatch(/only active admin/);
    expect(
      lastAdminBlock({
        targetIsActiveAdmin: true,
        otherActiveAdmins: 1,
        nextIsAdmin: false,
      }),
    ).toBeNull();
    expect(
      lastAdminBlock({
        targetIsActiveAdmin: true,
        otherActiveAdmins: 0,
        nextIsAdmin: true,
      }),
    ).toBeNull();
    expect(
      lastAdminBlock({
        targetIsActiveAdmin: false,
        otherActiveAdmins: 0,
        nextIsAdmin: false,
      }),
    ).toBeNull();
  });

  it("deactivation revokes sessions, emits user.deactivated, keeps history", async () => {
    const sid = randomUUID();
    await db.insert(sessions).values({
      id: sid,
      userId: uid.b,
      tokenHash: `h-${sid}`,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const r = await deactivateUserAction({ userId: uid.b });
    expect(r.ok).toBe(true);
    const u = await one<{ status: string; deactivated_at: Date | null }>(
      sql`select status, deactivated_at from users where id = ${uid.b}`,
    );
    expect(u.status).toBe("deactivated");
    expect(u.deactivated_at).not.toBeNull();
    const live = await one<{ n: number }>(
      sql`select count(*)::int n from sessions where user_id = ${uid.b} and revoked_at is null`,
    );
    expect(live.n).toBe(0);
    const ev = await one<{ n: number }>(
      sql`select count(*)::int n from events where type = 'user.deactivated' and entity_id = ${uid.b}`,
    );
    expect(ev.n).toBe(1);
    expect((await listUsers()).some((x) => x.id === uid.b)).toBe(false);
  });

  it("the last active admin can't be demoted or deactivated; self-deactivation blocked", async () => {
    const demote = await changeRoleAction({ userId: uid.a, role: "office" });
    expect(demote.ok).toBe(false);
    expect((await deactivateUserAction({ userId: uid.a })).ok).toBe(false);
    // reactivating the second admin makes demotion possible again
    expect((await reactivateUserAction({ userId: uid.b })).ok).toBe(true);
    const ok = await changeRoleAction({ userId: uid.b, role: "office" });
    expect(ok.ok).toBe(true);
    const b = (await getUserBriefs([uid.b]))[uid.b];
    expect(b?.baseRole).toBe("office");
  });

  it("invites create a 7-day link and reject duplicates", async () => {
    const r = await inviteUserAction({
      name: "Jo New",
      email: "jo@p.test",
      role: "tech",
      workerType: "1099",
      sendEmail: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data?.url).toMatch(/\/invite\//);
    const again = await inviteUserAction({
      name: "Jo New",
      email: "jo@p.test",
      role: "tech",
      workerType: "1099",
    });
    expect(again.ok).toBe(false);
    const neither = await inviteUserAction({
      name: "Nobody",
      role: "tech",
      workerType: "1099",
    });
    expect(neither.ok).toBe(false);
  });

  it("non-managers can't invite admins", async () => {
    await as(uid.o);
    const r = await inviteUserAction({
      name: "X",
      email: "x@p.test",
      role: "admin",
      workerType: "1099",
    });
    expect(r.ok).toBe(false);
    await as(uid.a);
  });
});

describe("tags and custom fields API (S55/S56 contracts)", () => {
  it("tags apply per entity type and replace on set", async () => {
    const t = await saveTagAction({
      name: "VIP",
      color: "purple",
      appliesTo: ["customer", "job"],
    });
    expect(t.ok).toBe(true);
    const tags = await listTags("customer");
    const vip = tags.find((x) => x.name === "VIP");
    expect(vip).toBeTruthy();
    expect((await listTags("vehicle")).some((x) => x.name === "VIP")).toBe(
      false,
    );
    const cust = randomUUID();
    await db.transaction((tx) =>
      setEntityTags(
        tx,
        { type: "customer", id: cust },
        [vip?.id as string],
        SYSTEM_ACTOR,
      ),
    );
    expect(
      (await getEntityTags([{ type: "customer", id: cust }]))[cust]?.map(
        (x) => x.name,
      ),
    ).toEqual(["VIP"]);
    await db.transaction((tx) =>
      setEntityTags(tx, { type: "customer", id: cust }, [], SYSTEM_ACTOR),
    );
    expect(
      (await getEntityTags([{ type: "customer", id: cust }]))[cust] ?? [],
    ).toEqual([]);
  });

  it("custom fields validate required + types", async () => {
    const r = await saveCustomFieldAction({
      entityType: "property",
      label: "Lock brand",
      type: "select",
      options: "Schlage\nKwikset",
      required: true,
      showOnInvoice: false,
      active: true,
    });
    expect(r.ok).toBe(true);
    const defs = await getCustomFieldDefs("property");
    expect(defs.map((d) => d.label)).toContain("Lock brand");
    const key = defs.find((d) => d.label === "Lock brand")?.key as string;
    const bad = await validateCustomValues("property", { [key]: "Yale" });
    expect(bad.ok).toBe(false);
    const missing = await validateCustomValues("property", {});
    expect(missing.ok).toBe(false);
    const good = await validateCustomValues("property", { [key]: "Kwikset" });
    expect(good).toMatchObject({ ok: true, values: { [key]: "Kwikset" } });
  });
});

describe("brand color contrast (Settings → Branding)", () => {
  it("passes for the iOS blue and auto-adjusts a light yellow", () => {
    const blue = contrastReport("#007AFF");
    expect(blue?.ok).toBe(true);
    const yellow = contrastReport("#FFCC00");
    expect(yellow?.ok).toBe(true); // text color adjusted to stay readable
    expect(yellow?.adjusted.light).toBe(true);
    expect(yellow?.lines.find((l) => l.key === "fill-light")?.pass).toBe(false);
  });

  it("rejects junk", () => {
    expect(contrastReport("not a color")).toBeNull();
    expect(contrastReport(null)).toBeNull();
  });
});
