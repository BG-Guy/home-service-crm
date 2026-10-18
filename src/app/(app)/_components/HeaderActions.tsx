import { NotificationBell } from "@/features/notify/slots";
import { getCurrentUser } from "@/lib/auth/current";
import { getFeatureFlags } from "@/lib/settings";
import { iconFor } from "@/ui/icons";
import { CreateMenu } from "./CreateMenu";
import { createItemsFor } from "./create-items";
import { SearchButton } from "./SearchButton";

/**
 * Trailing nav-bar actions for top-level app pages (SPEC §13.1 global elements):
 * search (⌘K), the context-aware "+" create menu and the notification bell (S34).
 *
 * ```tsx
 * <LargeTitleHeader title="Customers" trailing={<HeaderActions />} />
 * ```
 */
export async function HeaderActions({ create = true }: { create?: boolean }) {
  const [user, flags] = await Promise.all([
    getCurrentUser(),
    getFeatureFlags(),
  ]);
  if (!user) return null;
  // Icons render here (server) so the icon map stays out of the client bundle.
  const items = (create ? createItemsFor(user.perms, flags) : []).map((i) => {
    const Icon = iconFor(i.icon);
    return { ...i, iconNode: <Icon aria-hidden size={20} /> };
  });
  return (
    <>
      <SearchButton />
      {items.length > 0 && <CreateMenu items={items} />}
      <NotificationBell />
    </>
  );
}
