import "server-only";
import type { SettingsGroup } from "@/features/registry";
import { navForUser } from "@/lib/nav";
import { getFeatureFlags } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { iconFor } from "@/ui/icons";
import type { Tone } from "@/ui/tone";
import type { SettingsNavItem } from "./components/SettingsNav";

// The /settings index model (every module's nav entries with section 'settings',
// filtered by permission and feature flag), with icons rendered on the server so the
// icon map never reaches the client bundle.

export const GROUP_TONE: Record<SettingsGroup, Tone> = {
  business: "blue",
  work: "orange",
  money: "green",
  communication: "teal",
  team: "indigo",
  fleet: "brown",
  system: "gray",
};

export async function settingsGroupsFor(user: SessionUser): Promise<
  {
    key: SettingsGroup;
    label: string;
    items: (SettingsNavItem & { description?: string })[];
  }[]
> {
  const model = navForUser(user, await getFeatureFlags());
  return model.settings.map((g) => ({
    key: g.key,
    label: g.label,
    items: g.items.map((i) => {
      const Icon = iconFor(i.icon);
      return {
        key: i.key,
        href: i.href,
        label: i.label,
        description: i.description,
        tone: GROUP_TONE[g.key] ?? "gray",
        icon: <Icon size={16} color="white" aria-hidden />,
      };
    }),
  }));
}
