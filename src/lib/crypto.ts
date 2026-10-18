import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { sessionSecret } from "./env";

// Encryption at rest (SPEC §6.1): AES-256-GCM with a key derived by HKDF from
// SESSION_SECRET (env DATA_KEY overrides). Format: `v1:<iv>:<ct>:<tag>` (base64url).
// Used for gate codes, bank numbers and integration secrets.

let cachedKey: Buffer | null = null;
let cachedFrom = "";

function dataKey(): Buffer {
  const root = process.env.DATA_KEY || sessionSecret();
  if (cachedKey && cachedFrom === root) return cachedKey;
  cachedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(root),
      Buffer.from("crm-data-key"),
      Buffer.from("v1"),
      32,
    ),
  );
  cachedFrom = root;
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${ct.toString("base64url")}:${tag.toString("base64url")}`;
}

export function decrypt(value: string): string {
  const [v, iv, ct, tag] = value.split(":");
  if (v !== "v1" || !iv || ct === undefined || !tag)
    throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dataKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** decrypt() that returns null for null/invalid input. */
export function decryptOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith("v1:");
}
