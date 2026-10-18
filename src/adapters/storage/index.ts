import "server-only";
import { localStorageProvider } from "./local";
import { s3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

// Storage adapter (SPEC §9.3). STORAGE_DRIVER = local (default) | s3.
// Private bucket; reads via short-lived signed GET URLs (10 min).

export { isSafeKey, MIME_EXT, mediaKeys, mimeFromKey } from "./keys";
export { verifyLocalUrl } from "./local";
export type { StorageProvider } from "./types";

export function storageDriverName(): "local" | "s3" {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
}

export function getStorage(): StorageProvider {
  return storageDriverName() === "s3"
    ? s3StorageProvider
    : localStorageProvider;
}
