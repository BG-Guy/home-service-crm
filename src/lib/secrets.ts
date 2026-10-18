import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { secrets } from "@/db/schema";
import { writeAudit } from "./audit";
import { decryptOrNull, encrypt } from "./crypto";
import type { Actor } from "./types";

// Integration credentials (SPEC M21 Integrations, §6.2 `secrets`). Env always wins;
// otherwise the encrypted value set in /settings/integrations. Write-only in the UI
// (only the last 4 characters are ever shown).

/** Secret keys the integrations page manages (env var names). */
export const SECRET_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "GEMINI_API_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "TURNSTILE_SECRET",
  "VAPID_PRIVATE_KEY",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number] | (string & {});

const memo = new Map<string, { value: string | null; at: number }>();
const MEMO_MS = 30_000;

export async function getSecret(key: SecretKey): Promise<string | null> {
  const env = process.env[key];
  if (env) return env;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  let value: string | null = null;
  try {
    const [row] = await db
      .select({ v: secrets.valueEnc })
      .from(secrets)
      .where(eq(secrets.key, key))
      .limit(1);
    value = decryptOrNull(row?.v);
  } catch {
    value = null;
  }
  memo.set(key, { value, at: Date.now() });
  return value;
}

export async function setSecret(
  tx: Tx,
  key: SecretKey,
  value: string | null,
  actor: Actor,
): Promise<void> {
  memo.delete(key);
  if (value === null || value === "") {
    await tx.delete(secrets).where(eq(secrets.key, key));
  } else {
    const last4 = value.slice(-4);
    await tx
      .insert(secrets)
      .values({
        key,
        valueEnc: encrypt(value),
        last4,
        updatedBy: actor.userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: secrets.key,
        set: {
          valueEnc: encrypt(value),
          last4,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        },
      });
  }
  await writeAudit(tx, {
    actor,
    action: value ? "secret.set" : "secret.cleared",
    after: { key, last4: value ? value.slice(-4) : null },
    full: true,
  });
}

/** For the integrations page: where each secret comes from (never the value). */
export async function listSecretStatus(): Promise<
  { key: string; source: "env" | "db" | "none"; last4: string | null }[]
> {
  const rows = await db
    .select({ key: secrets.key, last4: secrets.last4 })
    .from(secrets);
  const byKey = new Map(rows.map((r) => [r.key, r.last4]));
  const keys = new Set<string>([...SECRET_KEYS, ...byKey.keys()]);
  return [...keys].map((key) => {
    const env = process.env[key];
    if (env) return { key, source: "env" as const, last4: env.slice(-4) };
    if (byKey.has(key))
      return { key, source: "db" as const, last4: byKey.get(key) ?? null };
    return { key, source: "none" as const, last4: null };
  });
}
