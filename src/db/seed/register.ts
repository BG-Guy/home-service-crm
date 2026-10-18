import "server-only";
import { registerBootHook } from "@/db";
import { seedBase } from "./base";

// Registers the idempotent base seed as a DB boot hook, so a fresh PGlite (or a
// freshly migrated Postgres) is usable on the first request. Imported for its side
// effect by src/instrumentation.ts and src/lib/auth/current.ts.
registerBootHook("base-seed", seedBase, { order: 10 });
