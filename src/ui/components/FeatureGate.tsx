import type { ReactNode } from "react";

/**
 * Renders `children` only when a feature is on (SPEC §12.6). Server Component;
 * it deliberately doesn't import settings or permissions — the caller passes
 * the decision (or an async check), so this stays usable anywhere:
 *
 * ```tsx
 * <FeatureGate enabled={(await isEnabled("tools")) && can(user, "tools.view")}>…</FeatureGate>
 * <FeatureGate check={() => isEnabled("map")} fallback={<Banner>Map is off</Banner>}>…</FeatureGate>
 * ```
 */
export async function FeatureGate({
  enabled,
  check,
  fallback = null,
  children,
}: {
  enabled?: boolean;
  /** Async/sync predicate evaluated on the server (ignored when `enabled` is set). */
  check?: () => boolean | Promise<boolean>;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const on = enabled ?? (check ? await check() : false);
  return <>{on ? children : fallback}</>;
}
