// Can a viewer open the page behind a dashboard tile or row? Same rule as the tab
// bar and sidebar (permission + feature flag), keyed by nav item, so a dashboard
// never links someone to a page they can't see (QA2 T4-09). Pure and client-safe.
import { allNavItems } from "@/features/registry";
import type { FeatureFlags } from "@/lib/flags";
import { isNavItemVisible, type NavViewer } from "@/lib/nav";

export function navAccess(
  viewer: NavViewer,
  flags: Partial<FeatureFlags>,
): (navKey: string) => boolean {
  const items = allNavItems();
  return (navKey) => {
    const item = items.find((i) => i.key === navKey);
    return item ? isNavItemVisible(item, viewer, flags) : false;
  };
}
