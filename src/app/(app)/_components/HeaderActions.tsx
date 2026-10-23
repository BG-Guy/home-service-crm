import { NotificationBell } from "@/features/notify/slots";
import { getCurrentUser } from "@/lib/auth/current";
import { getFeatureFlags } from "@/lib/settings";
import { iconFor } from "@/ui/icons";
import { CreateButtons } from "./CreateMenu";
import { createItemsFor, type PageCreateKey } from "./create-items";
import { SearchButton } from "./SearchButton";

/**
 * Trailing nav-bar actions for top-level app pages (SPEC §13.1 global elements):
 * the named create buttons (New lead, New job, New customer; leads flow item 5),
 * search (⌘K) and the notification bell (S34). A page with a create action of its
 * own passes `own` and gets it first (New estimate, Upload receipt, New tool,
 * New vehicle). `create={false}` leaves the create buttons out.
 *
 * ```tsx
 * <LargeTitleHeader title="Customers" trailing={<HeaderActions />} />
 * <LargeTitleHeader title="Estimates" trailing={<HeaderActions own="estimate" />} />
 * ```
 */
export async function HeaderActions({
  create = true,
  own,
}: {
  create?: boolean;
  own?: PageCreateKey;
}) {
  const [user, flags] = await Promise.all([
    getCurrentUser(),
    getFeatureFlags(),
  ]);
  if (!user) return null;
  // Icons render here (server) so the icon map stays out of the client bundle.
  const items = (create ? createItemsFor(user.perms, flags, own) : []).map(
    (i) => {
      const Icon = iconFor(i.icon);
      return {
        ...i,
        iconNode: <Icon aria-hidden size={20} strokeWidth={2} />,
        pillIcon: <Icon aria-hidden size={18} strokeWidth={2} />,
      };
    },
  );
  return (
    <>
      {items.length > 0 && <CreateButtons items={items} />}
      <SearchButton />
      <NotificationBell />
    </>
  );
}
