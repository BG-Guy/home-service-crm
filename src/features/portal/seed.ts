// Demo seed fragment for `portal` (BUILD_PLAN §10). Owner: B3.
// Write only your own tables; never emit events; use seedId() + onConflictDoNothing().
import type { DB } from "@/db";
import type { DemoSeedCtx } from "@/db/seed/types";

export async function seedDemo(_db: DB, _ctx: DemoSeedCtx): Promise<void> {}
