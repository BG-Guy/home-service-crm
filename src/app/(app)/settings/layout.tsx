import type { ReactNode } from "react";
import { SettingsNav } from "@/features/settings/components/SettingsNav";
import { settingsGroupsFor } from "@/features/settings/nav-model";
import { getCurrentUser } from "@/lib/auth/current";

// Settings shell (SPEC M21, §12.4). Phones: each settings page is a pushed screen
// with a back button to /settings. Desktop (≥ 1024 px): a sticky settings column
// next to the page, like iPadOS Settings. Pages do their own requireUser(perm).
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) return children;
  const groups = await settingsGroupsFor(user);
  return (
    <div className="lg:grid lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside
        data-chrome
        className="hidden print:hidden lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto lg:overscroll-contain lg:shadow-[inset_-0.5px_0_0_var(--sep)]"
      >
        <SettingsNav
          title="Settings"
          groups={groups.map((g) => ({
            key: g.key,
            label: g.label,
            items: g.items.map(({ description: _d, ...i }) => i),
          }))}
        />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
