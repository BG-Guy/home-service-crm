"use server";

import { z } from "zod";
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
