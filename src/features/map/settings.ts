// Settings fragment(s) owned by module `map` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

export const settingsShape = {
  map: z
    .object({
      keep_breadcrumbs_days: z.number().int().min(0).max(30).default(0),
      ping_interval_sec: z.number().int().min(60).default(60),
      stale_minutes: z.number().int().default(15),
      hide_after_minutes: z.number().int().default(60),
      // Street map tiles for every map (Settings → Map, "OpenStreetMap (free)").
      // Empty = off in production; NEXT_PUBLIC_TILE_URL always wins.
      tile_url: z.string().max(500).default(""),
      tile_attribution: z.string().max(300).default(""),
    })
    .prefault({}),
} as const;
