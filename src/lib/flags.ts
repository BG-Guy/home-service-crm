// Feature flags (SPEC §5, §15.4), derived from every module's permissions.ts `flags`.
// Client-safe: the root layout passes the resolved map to client components.
import { flags as disputes } from "@/features/disputes/permissions";
import { flags as estimates } from "@/features/estimates/permissions";
import { flags as leads } from "@/features/leads/permissions";
import { flags as map } from "@/features/map/permissions";
import { flags as media } from "@/features/media/permissions";
import { flags as parts } from "@/features/parts/permissions";
import { flags as payments } from "@/features/payments/permissions";
import { flags as payroll } from "@/features/payroll/permissions";
import { flags as reviews } from "@/features/reviews/permissions";
import { flags as tools } from "@/features/tools/permissions";
import { flags as vehicles } from "@/features/vehicles/permissions";

/** Every flag declared by a module, in §5 table order. */
export const FEATURE_FLAG_DEFS = [
  ...leads,
  ...estimates,
  ...payments,
  ...disputes,
  ...media,
  ...reviews,
  ...parts,
  ...payroll,
  ...vehicles,
  ...tools,
  ...map,
] as const;

export type FeatureFlag = (typeof FEATURE_FLAG_DEFS)[number]["key"];
export type FeatureFlags = Record<FeatureFlag, boolean>;

export const FEATURE_FLAGS = FEATURE_FLAG_DEFS.map(
  (f) => f.key,
) as FeatureFlag[];

/** Defaults from the manifests (tools and inventory off; everything else on). */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.fromEntries(
  FEATURE_FLAG_DEFS.map((f) => [f.key, f.default]),
) as FeatureFlags;

export function isFeatureFlag(key: string): key is FeatureFlag {
  return (FEATURE_FLAGS as string[]).includes(key);
}
