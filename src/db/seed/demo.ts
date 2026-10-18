import "server-only";
import { inArray, sql } from "drizzle-orm";
import { closeDb, type DB, db, ensureDb, execRows } from "@/db";
import { users } from "@/db/schema";
import { seedDemo as approvals } from "@/features/approvals/seed";
import { seedDemo as automations } from "@/features/automations/seed";
import { seedDemo as customers } from "@/features/customers/seed";
import { seedDemo as data } from "@/features/data/seed";
import { seedDemo as disputes } from "@/features/disputes/seed";
import { seedDemo as estimates } from "@/features/estimates/seed";
import { seedDemo as insights } from "@/features/insights/seed";
import { seedDemo as invoices } from "@/features/invoices/seed";
import { seedDemo as jobs } from "@/features/jobs/seed";
import { seedDemo as leads } from "@/features/leads/seed";
import { seedDemo as map } from "@/features/map/seed";
import { seedDemo as media } from "@/features/media/seed";
import { seedDemo as messaging } from "@/features/messaging/seed";
import { seedDemo as notify } from "@/features/notify/seed";
import { seedDemo as parts } from "@/features/parts/seed";
import { seedDemo as payments } from "@/features/payments/seed";
import { seedDemo as payroll } from "@/features/payroll/seed";
import { seedDemo as portal } from "@/features/portal/seed";
import { seedDemo as pricebook } from "@/features/pricebook/seed";
import { seedDemo as reviews } from "@/features/reviews/seed";
import { seedDemo as settings } from "@/features/settings/seed";
import { seedDemo as signatures } from "@/features/signatures/seed";
import { seedDemo as tasks } from "@/features/tasks/seed";
import { seedDemo as team } from "@/features/team/seed";
import { seedDemo as tech } from "@/features/tech/seed";
import { seedDemo as time } from "@/features/time/seed";
import { seedDemo as tools } from "@/features/tools/seed";
import { seedDemo as vehicles } from "@/features/vehicles/seed";
import { processEvents } from "@/lib/events";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { seedBase } from "./base";
import { seedDemo as core } from "./demo-core";
import { forkRng } from "./demo-ids";
import { DEMO, DEMO_PROFILE, DEMO_TODAY_PAST_UNTIL } from "./demo-plan";
import { truncateDomainTables } from "./helpers";
import type { DemoSeedCtx } from "./types";

// Demo seed runner (BUILD_PLAN §10.1, §10.3): migrate → base seed → fragments in order.
// `reset` empties every domain table first; otherwise the run refuses when demo users exist.

type Fragment = {
  name: string;
  owner: string;
  run: (db: DB, ctx: DemoSeedCtx) => Promise<void>;
};

export const DEMO_FRAGMENTS: readonly Fragment[] = [
  { name: "demo-core", owner: "F", run: core },
  { name: "team", owner: "B8", run: team },
  { name: "settings", owner: "B8", run: settings },
  { name: "pricebook", owner: "B3", run: pricebook },
  { name: "customers", owner: "B1", run: customers },
  { name: "leads", owner: "B1", run: leads },
  { name: "jobs", owner: "B2", run: jobs },
  { name: "time", owner: "B2", run: time },
  { name: "estimates", owner: "B3", run: estimates },
  { name: "invoices", owner: "B3", run: invoices },
  { name: "media", owner: "B4", run: media },
  { name: "payments", owner: "B4", run: payments },
  { name: "disputes", owner: "B4", run: disputes },
  { name: "messaging", owner: "B5", run: messaging },
  { name: "reviews", owner: "B5", run: reviews },
  { name: "notify", owner: "B5", run: notify },
  { name: "vehicles", owner: "B7", run: vehicles },
  { name: "tools", owner: "B7", run: tools },
  { name: "map", owner: "B7", run: map },
  { name: "parts", owner: "B6", run: parts },
  { name: "payroll", owner: "B6", run: payroll },
  // No-op fragments (kept so the import list is static).
  { name: "data", owner: "B1", run: data },
  { name: "insights", owner: "B8", run: insights },
  { name: "automations", owner: "B5", run: automations },
  { name: "portal", owner: "B3", run: portal },
  { name: "signatures", owner: "B3", run: signatures },
  { name: "tasks", owner: "B2", run: tasks },
  { name: "approvals", owner: "B6", run: approvals },
  { name: "tech", owner: "B2", run: tech },
];

export function makeDemoCtx(
  now: Date,
  log: (msg: string) => void,
  fragment = "demo",
): DemoSeedCtx {
  const tz = DEMO.company.timezone;
  const today = dateKey(now, tz);
  const at = (dayOffset: number, hhmm: string): Date => {
    const [h, m] = hhmm.split(":").map(Number);
    return zonedTimeToUtc(
      {
        ...parseDateKey(addDaysToKey(today, dayOffset)),
        hour: h ?? 0,
        minute: m ?? 0,
      },
      tz,
    );
  };
  const latest = now.getTime() - 60_000;
  const past = (d: Date): Date => (d.getTime() > latest ? new Date(latest) : d);
  // Seeding at 07:00: today's 08:00–11:30 history moves back so it ends 10 min ago.
  const todayShiftMs = Math.max(
    0,
    at(0, DEMO_TODAY_PAST_UNTIL).getTime() - (now.getTime() - 10 * 60_000),
  );
  return {
    now,
    tz,
    plan: DEMO,
    profile: DEMO_PROFILE,
    at,
    atPast(dayOffset, hhmm) {
      const t = at(dayOffset, hhmm);
      return past(dayOffset === 0 ? new Date(t.getTime() - todayShiftMs) : t);
    },
    past,
    rng: forkRng(fragment),
    log,
  };
}

export interface DemoSeedResult {
  fragments: { name: string; ms: number; error?: string }[];
  counts: Record<string, number>;
  ms: number;
}

export class DemoAlreadySeededError extends Error {
  constructor() {
    super("Demo users already exist. Re-run with --reset to wipe and reseed.");
  }
}

export async function runDemoSeed(
  opts: { reset?: boolean; now?: Date; log?: (msg: string) => void } = {},
): Promise<DemoSeedResult> {
  const log = opts.log ?? ((m: string) => console.log(`[seed] ${m}`));
  const started = Date.now();
  await ensureDb(); // migrations + base seed (boot hook)
  if (opts.reset) {
    const n = await truncateDomainTables(db);
    log(`reset: emptied ${n} tables`);
  }
  await seedBase(db);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(
      inArray(
        users.id,
        DEMO.users.map((u) => u.id),
      ),
    );
  if (existing.length > 0) throw new DemoAlreadySeededError();

  const now = opts.now ?? new Date();
  const fragments: DemoSeedResult["fragments"] = [];
  for (const f of DEMO_FRAGMENTS) {
    const t = Date.now();
    try {
      await f.run(
        db,
        makeDemoCtx(now, (m) => log(`${f.name}: ${m}`), f.name),
      );
      fragments.push({ name: f.name, ms: Date.now() - t });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fragments.push({ name: f.name, ms: Date.now() - t, error: message });
      log(`${f.name} (${f.owner}) FAILED: ${message}`);
      if (f.owner === "F") throw err;
    }
  }
  await processEvents({ timeBudgetMs: 5_000 });
  const counts: Record<string, number> = {};
  for (const table of [
    "users",
    "customers",
    "properties",
    "leads",
    "jobs",
    "invoices",
    "payments",
    "media",
    "vehicles",
    "tools",
    "events",
  ]) {
    const rows = await execRows<{ n: number }>(
      sql.raw(`select count(*)::int as n from "${table}"`),
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return { fragments, counts, ms: Date.now() - started };
}

export { closeDb };
