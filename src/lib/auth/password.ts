import "server-only";
import { argon2, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { COMMON_PASSWORDS } from "./common-passwords";

// Password hashing (SPEC M01): Argon2id PHC string, m=19456 KiB, t=2, p=1 via
// node:crypto (Node ≥ 24.7). Rehash on login when parameters change. scrypt is only
// a fallback for runtimes without crypto.argon2.

export const ARGON2_PARAMS = {
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, keylen: 32 } as const;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
const unb64 = (s: string) => Buffer.from(s, "base64");

function argon2Async(
  message: string,
  nonce: Buffer,
  p = ARGON2_PARAMS,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    argon2(
      "argon2id",
      {
        message,
        nonce,
        memory: p.memory,
        passes: p.passes,
        parallelism: p.parallelism,
        tagLength: p.tagLength,
      },
      (err, key) => (err ? reject(err) : resolve(Buffer.from(key))),
    ),
  );
}

function scryptAsync(
  password: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keylen: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      keylen,
      { N, r, p, maxmem: 256 * N * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export const hasArgon2 = typeof argon2 === "function";

/** Hash a password into a PHC string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  if (hasArgon2) {
    const hash = await argon2Async(password, salt);
    const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
    return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
  }
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const hash = await scryptAsync(password, salt, N, r, p, keylen);
  return `$scrypt$ln=${Math.log2(N)},r=${r},p=${p}$${b64(salt)}$${b64(hash)}`;
}

interface ParsedHash {
  alg: "argon2id" | "scrypt";
  params: Record<string, number>;
  salt: Buffer;
  hash: Buffer;
}

function parsePhc(phc: string): ParsedHash | null {
  const parts = phc.split("$");
  // argon2id: ['', 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, hash]
  // scrypt:   ['', 'scrypt', 'ln=..,r=..,p=..', salt, hash]
  const alg = parts[1];
  if (alg === "argon2id" && parts.length === 6) {
    return {
      alg,
      params: kv(parts[3] ?? ""),
      salt: unb64(parts[4] ?? ""),
      hash: unb64(parts[5] ?? ""),
    };
  }
  if (alg === "scrypt" && parts.length === 5) {
    return {
      alg,
      params: kv(parts[2] ?? ""),
      salt: unb64(parts[3] ?? ""),
      hash: unb64(parts[4] ?? ""),
    };
  }
  return null;
}

function kv(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of s.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) out[k] = Number(v);
  }
  return out;
}

/** Constant-time verify against a stored PHC string. False for malformed hashes. */
export async function verifyPassword(
  password: string,
  phc: string | null | undefined,
): Promise<boolean> {
  if (!phc) return false;
  const parsed = parsePhc(phc);
  if (!parsed || parsed.hash.length === 0) return false;
  let computed: Buffer;
  try {
    if (parsed.alg === "argon2id") {
      if (!hasArgon2) return false;
      computed = await argon2Async(password, parsed.salt, {
        memory: parsed.params.m ?? ARGON2_PARAMS.memory,
        passes: parsed.params.t ?? ARGON2_PARAMS.passes,
        parallelism: parsed.params.p ?? ARGON2_PARAMS.parallelism,
        tagLength: parsed.hash.length,
      } as typeof ARGON2_PARAMS);
    } else {
      const N = 2 ** (parsed.params.ln ?? 17);
      computed = await scryptAsync(
        password,
        parsed.salt,
        N,
        parsed.params.r ?? 8,
        parsed.params.p ?? 1,
        parsed.hash.length,
      );
    }
  } catch {
    return false;
  }
  return (
    computed.length === parsed.hash.length &&
    timingSafeEqual(computed, parsed.hash)
  );
}

/** True when the stored hash should be upgraded (other algorithm or parameters). */
export function needsRehash(phc: string | null | undefined): boolean {
  if (!phc) return true;
  const parsed = parsePhc(phc);
  if (!parsed) return true;
  if (!hasArgon2) return parsed.alg !== "scrypt";
  if (parsed.alg !== "argon2id") return true;
  return (
    parsed.params.m !== ARGON2_PARAMS.memory ||
    parsed.params.t !== ARGON2_PARAMS.passes ||
    parsed.params.p !== ARGON2_PARAMS.parallelism ||
    parsed.hash.length !== ARGON2_PARAMS.tagLength
  );
}

/** A fixed dummy hash so unknown-email logins take the same time as real ones. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

/**
 * Password policy (SPEC M01): ≥ 10 chars, not in the bundled common-password list,
 * not trivially derived from the user's email/name/company. Returns an error message or null.
 */
export function checkPasswordPolicy(
  password: string,
  context: {
    email?: string | null;
    name?: string | null;
    company?: string | null;
  } = {},
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return "That password is too long.";
  const lower = password.toLowerCase();
  if (
    COMMON_PASSWORDS.has(lower) ||
    COMMON_PASSWORDS.has(lower.replace(/[\d!@#$%^&*.]+$/, ""))
  ) {
    return "That password is too common. Pick something less guessable.";
  }
  if (/^(.)\1+$/.test(password)) return "That password is too simple.";
  if (isSequential(lower)) return "That password is too simple.";
  const parts = [context.email?.split("@")[0], context.name, context.company]
    .flatMap((s) => (s ?? "").toLowerCase().split(/[^a-z0-9]+/))
    .filter((s) => s.length >= 4);
  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (parts.some((p) => stripped === p || stripped.replace(/\d+$/, "") === p)) {
    return "Don't use your name, email or company as your password.";
  }
  return null;
}

function isSequential(s: string): boolean {
  const seqs = [
    "0123456789",
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiopasdfghjklzxcvbnm",
    "9876543210",
  ];
  return seqs.some(
    (seq) => seq.includes(s) || (s.length >= 10 && seq.repeat(2).includes(s)),
  );
}
