// Navigation derived from module manifests (SPEC §13; BUILD_PLAN §3.3 notes).
// Pure: compute on the server (shell layout) and pass the result to client components.
//  - tabs:     mobile tab bar for the user's base role (§13.1), max 4 + "More"
//  - more:     the grouped More list (items already shown as tabs are omitted)
//  - sidebar:  desktop sidebar sections (§13.2); section "settings" lists settings pages
//  - settings: the /settings index, grouped
import type { BaseRole } from "@/db/enums";
import {
  allNavItems,
  type BadgeKey,
  type MoreGroup,
  type NavItem,
  type SettingsGroup,
  type SidebarSection,
} from "@/features/registry";
import type { FeatureFlags } from "./flags";
import type { Perm } from "./permissions";

export interface NavViewer {
  baseRole: BaseRole;
  perms: ReadonlySet<Perm>;
}

export interface ResolvedNavItem {
  key: string;
  href: string;
  label: string;
  icon: string;
  badge?: BadgeKey;
  action?: "signout" | "install";
  description?: string;
}

export interface NavGroup<G extends string> {
  key: G;
  label: string;
  items: ResolvedNavItem[];
}

export interface NavModel {
  tabs: ResolvedNavItem[];
  more: NavGroup<MoreGroup>[];
  sidebar: NavGroup<SidebarSection>[];
  settings: NavGroup<SettingsGroup>[];
}

export const MORE_GROUPS: { key: MoreGroup; label: string }[] = [
  { key: "work", label: "Work" },
  { key: "team", label: "Team" },
  { key: "fleet", label: "Fleet" },
  { key: "insights", label: "Insights" },
  { key: "account", label: "Account" },
  { key: "admin", label: "Admin" },
];

export const SIDEBAR_SECTIONS: { key: SidebarSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "work", label: "Work" },
  { key: "customers", label: "Customers" },
  { key: "money", label: "Money" },
  { key: "operations", label: "Operations" },
  { key: "settings", label: "Settings" },
];

export const SETTINGS_GROUPS: { key: SettingsGroup; label: string }[] = [
  { key: "business", label: "Business" },
  { key: "work", label: "Work" },
  { key: "money", label: "Money" },
  { key: "communication", label: "Messages & automations" },
  { key: "team", label: "Team" },
  { key: "fleet", label: "Fleet & field" },
  { key: "system", label: "System" },
];

/** Is a nav item visible to this viewer with these flags? (perm array = any of) */
export function isNavItemVisible(
  item: NavItem,
  viewer: NavViewer,
  flags: Partial<FeatureFlags>,
): boolean {
  if (item.flag && !flags[item.flag]) return false;
  if (item.roles && !item.roles.includes(viewer.baseRole)) return false;
  if (item.perm) {
    const perms = (
      Array.isArray(item.perm) ? item.perm : [item.perm]
    ) as Perm[];
    if (!perms.some((p) => viewer.perms.has(p))) return false;
  }
  return true;
}

function resolve(
  item: NavItem,
  role: BaseRole,
  label?: string,
): ResolvedNavItem {
  const o = item.byRole?.[role];
  return {
    key: item.key,
    href: o?.href ?? item.href,
    label: label ?? o?.label ?? item.label,
    icon: o?.icon ?? item.icon,
    ...(item.badge ? { badge: item.badge } : {}),
    ...(item.action ? { action: item.action } : {}),
    ...(item.description ? { description: item.description } : {}),
  };
}

export function buildNav(
  items: readonly NavItem[],
  viewer: NavViewer,
  flags: Partial<FeatureFlags>,
): NavModel {
  const role = viewer.baseRole;
  const visible = items.filter((i) => isNavItemVisible(i, viewer, flags));

  const tabItems = visible
    .filter((i) => typeof i.tabPriority?.[role] === "number")
    .sort((a, b) => (a.tabPriority?.[role] ?? 0) - (b.tabPriority?.[role] ?? 0))
    .slice(0, 4);
  const tabKeys = new Set(tabItems.map((i) => i.key));
  const tabs = tabItems.map((i) => resolve(i, role));

  const more = MORE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: visible
      .filter((i) => i.more === g.key && !tabKeys.has(i.key))
      .sort((a, b) => (a.moreOrder ?? 99) - (b.moreOrder ?? 99))
      .map((i) => resolve(i, role, i.moreLabel)),
  })).filter((g) => g.items.length > 0);

  const sidebar = SIDEBAR_SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    items: visible
      .filter((i) => i.section === s.key)
      .sort(
        (a, b) =>
          (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label),
      )
      .map((i) => resolve(i, role)),
  })).filter((s) => s.items.length > 0);

  const settings = SETTINGS_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: visible
      .filter(
        (i) =>
          i.section === "settings" &&
          i.href !== "/settings" &&
          (i.settingsGroup ?? "system") === g.key,
      )
      .sort(
        (a, b) =>
          (a.order ?? 50) - (b.order ?? 50) || a.label.localeCompare(b.label),
      )
      .map((i) => resolve(i, role)),
  })).filter((g) => g.items.length > 0);

  return { tabs, more, sidebar, settings };
}

/** Navigation for the signed-in user from every module manifest (SPEC §13). */
export function navForUser(
  viewer: NavViewer,
  flags: Partial<FeatureFlags>,
): NavModel {
  return buildNav(allNavItems(), viewer, flags);
}

/** All badge keys referenced by visible nav items (fetch counts with getBadgeCounts). */
export function badgeKeysFor(model: NavModel): BadgeKey[] {
  const keys = new Set<BadgeKey>();
  for (const i of [
    ...model.tabs,
    ...model.more.flatMap((g) => g.items),
    ...model.sidebar.flatMap((s) => s.items),
  ]) {
    if (i.badge) keys.add(i.badge);
  }
  return [...keys];
}
