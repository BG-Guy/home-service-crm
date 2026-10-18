import { createHash } from "node:crypto";

// Deterministic seed ids (BUILD_PLAN §10.1): a UUID-v4-shaped value derived from
// sha256('crm-seed:' + ns + ':' + key), version nibble 4, variant 8.
// e.g. seedId('job', 12), seedId('service_type', 'repair'), seedId('user', 'admin').
export function seedId(ns: string, key: string | number): string {
  const h = createHash("sha256").update(`crm-seed:${ns}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fork a child RNG for a named fragment (stable regardless of fragment order). */
export function forkRng(name: string, base = 42): () => number {
  let h = base >>> 0;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  return mulberry32(h);
}
