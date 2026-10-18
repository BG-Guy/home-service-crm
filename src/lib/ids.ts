// Identifier helpers (docs/SPEC.md §6.1). Primary keys are UUIDs (DB default
// gen_random_uuid()); app/client-generated ids (offline client_id, idempotency) use
// crypto.randomUUID(), available in Node ≥ 19 and all modern browsers. Isomorphic.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** New random UUID v4 (same shape as the DB default). */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Human document number from a `counters` row: ('J-', 1042) → 'J-1042'.
 * The value comes from the gapless counter UPDATE … RETURNING in the same tx.
 */
export function formatDocNumber(
  prefix: string,
  value: number | bigint | string,
): string {
  return `${prefix}${String(value)}`;
}

/** Card statement descriptor suffix from a doc number: 'J-1042' → 'J1042'. */
export function descriptorSuffix(docNumber: string): string {
  return docNumber
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase();
}
