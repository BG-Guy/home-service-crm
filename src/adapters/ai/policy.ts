import "server-only";
import { sql } from "drizzle-orm";
import { execRows } from "@/db";
import { envInt } from "@/lib/env";
import type { AiTaskKind } from "./types";

// AI policy layer (SPEC §9.4; owned by F): tier allowlist, PII guard, daily budget.
// AI never blocks a workflow and is never on the money path; results are suggestions.

export type PolicyDecision =
  | { ok: true }
  | { ok: false; status: "skipped_policy" | "skipped_budget"; reason: string };

/** Kinds allowed on the free tier (no documents such as registration/insurance). */
export const FREE_TIER_KINDS: readonly AiTaskKind[] = [
  "odometer",
  "receipt",
  "shop_invoice",
  "tool_label",
  "maintenance_suggest",
  "explain_flags",
];

const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { name: "phone", re: /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  {
    name: "street address",
    re: /\b\d{1,6}\s+[A-Z0-9][A-Za-z0-9.'-]*(\s+[A-Za-z0-9.'-]+){0,4}\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|hwy)\b/i,
  },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

/** Returns the PII categories found in a text prompt (empty = clean). */
export function findPii(text: string): string[] {
  return PII_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function aiTier(): "free" | "paid" {
  return process.env.AI_TIER === "paid" ? "paid" : "free";
}

/** Static policy: tier allowlist, document refusal on free tier, PII in text prompts. */
export function checkPolicy(i: {
  kind: AiTaskKind;
  tier?: "free" | "paid";
  /** True when the images are customer/vehicle documents (registration, insurance, IDs). */
  isDocument?: boolean;
  prompt?: string | null;
}): PolicyDecision {
  const tier = i.tier ?? aiTier();
  if (tier === "free") {
    if (!FREE_TIER_KINDS.includes(i.kind))
      return {
        ok: false,
        status: "skipped_policy",
        reason: `${i.kind} not allowed on the free tier`,
      };
    if (i.isDocument)
      return {
        ok: false,
        status: "skipped_policy",
        reason: "documents are never sent on the free tier",
      };
    if (i.prompt) {
      const pii = findPii(i.prompt);
      if (pii.length)
        return {
          ok: false,
          status: "skipped_policy",
          reason: `prompt contains PII (${pii.join(", ")})`,
        };
    }
  }
  return { ok: true };
}

export function dailyBudget(): number {
  return envInt("AI_DAILY_BUDGET", 20);
}

/** Atomically consume one request of today's budget (UTC day). False when over budget. */
export async function consumeBudget(now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const limit = dailyBudget();
  const rows = await execRows<{ requests: number }>(sql`
    insert into ai_usage (day, requests) values (${day}::date, 1)
    on conflict (day) do update set requests = ai_usage.requests + 1
    where ai_usage.requests < ${limit}
    returning requests`);
  return rows.length > 0;
}

export async function budgetUsedToday(now = new Date()): Promise<number> {
  const rows = await execRows<{ requests: number }>(
    sql`select requests from ai_usage where day = ${now.toISOString().slice(0, 10)}::date`,
  );
  return Number(rows[0]?.requests ?? 0);
}
