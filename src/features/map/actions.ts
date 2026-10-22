"use server";

import { z } from "zod";
import { OSM_TILE_ATTRIBUTION, OSM_TILE_URL } from "@/adapters/maps";
import { action } from "@/lib/action";
import { updateSettings } from "@/lib/settings";

// Map settings (SPEC M19, /settings/map). Owner: B7.

export const saveMapSettings = action({
  perm: "settings.manage",
  input: z.object({
    keep_breadcrumbs_days: z.coerce.number().int().min(0).max(30),
    ping_interval_sec: z.coerce.number().int().min(60).max(900),
    stale_minutes: z.coerce.number().int().min(5).max(240),
    hide_after_minutes: z.coerce.number().int().min(15).max(1440),
  }),
  audit: "settings.map_updated",
  async run({ input, tx, actor }) {
    if (input.hide_after_minutes <= input.stale_minutes)
      input.hide_after_minutes = input.stale_minutes + 15;
    await updateSettings(tx, { map: input }, actor);
    return { ok: true };
  },
  revalidate: () => ["/settings/map", "/map"],
});

/**
 * Street map tiles (Settings → Map): the one-click "OpenStreetMap (free)" preset,
 * or off. Applies to every map (live map, Assign hub, schedule map, tracking page).
 */
export const saveMapTiles = action({
  perm: "settings.manage",
  input: z.object({ preset: z.enum(["osm", "off"]) }),
  audit: "settings.map_tiles_updated",
  async run({ input, tx, actor }) {
    await updateSettings(
      tx,
      {
        map:
          input.preset === "osm"
            ? { tile_url: OSM_TILE_URL, tile_attribution: OSM_TILE_ATTRIBUTION }
            : { tile_url: "", tile_attribution: "" },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => [
    "/settings/map",
    "/settings/integrations",
    "/map",
    "/schedule",
    "/dispatch",
  ],
});
