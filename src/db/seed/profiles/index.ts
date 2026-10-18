// Trade demo profiles registry (npm run seed:demo -- --profile=<key>).
// To add a trade: copy one of the profile modules, register it here, then run
// `npx vitest run tests/db/seed-profiles.test.ts` (CLAUDE.md §5).
import { CHIMNEY_PROFILE } from "./chimney";
import { DEFAULT_PROFILE } from "./default";
import { HANDYMAN_PROFILE } from "./handyman";
import { LOCKSMITH_PROFILE } from "./locksmith";
import type { DemoProfile } from "./types";

export const DEMO_PROFILES: Record<string, DemoProfile> = {
  default: DEFAULT_PROFILE,
  handyman: HANDYMAN_PROFILE,
  locksmith: LOCKSMITH_PROFILE,
  chimney: CHIMNEY_PROFILE,
};

/** Selectable with --profile= (the default runs when the flag is omitted). */
export const DEMO_PROFILE_KEYS = Object.keys(DEMO_PROFILES);

/** The profile for a key ('' or undefined → default); throws on an unknown key. */
export function resolveDemoProfile(
  key: string | undefined | null,
): DemoProfile {
  const k = (key ?? "").trim() || "default";
  const p = DEMO_PROFILES[k];
  if (!p)
    throw new Error(
      `Unknown demo profile "${k}". Use one of: ${DEMO_PROFILE_KEYS.join(", ")}.`,
    );
  return p;
}

export type { DemoProfile } from "./types";
