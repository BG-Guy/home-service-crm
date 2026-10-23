import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

// Temporary one-tap sign-in for the demo businesses (scripts/demo-businesses.sh).
// On only when DEMO_LOGIN_PASSWORD is set, which the demo script does and a real
// deployment never should. It still signs in through login() with that password,
// so the password check, throttle and audit trail all apply.

export const DEMO_ROLES = ["admin", "office", "tech"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function demoLoginPassword(): string | null {
  const p = process.env.DEMO_LOGIN_PASSWORD?.trim();
  return p ? p : null;
}

export interface DemoLogin {
  role: DemoRole;
  name: string;
  email: string;
}

/** The first active user of each role (by email: admin@, office@, tech1@ in the demo seeds). */
export async function demoLogin(role: DemoRole): Promise<DemoLogin | null> {
  if (!demoLoginPassword()) return null;
  const [u] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, role), eq(users.status, "active")))
    .orderBy(asc(users.email))
    .limit(1);
  return u ? { role, ...u } : null;
}

export async function listDemoLogins(): Promise<DemoLogin[]> {
  if (!demoLoginPassword()) return [];
  const all = await Promise.all(DEMO_ROLES.map(demoLogin));
  return all.filter((u): u is DemoLogin => u !== null);
}
