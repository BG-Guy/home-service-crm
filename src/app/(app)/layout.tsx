import Link from "next/link";
import type { ReactNode } from "react";
import { LocationSharer } from "@/features/map/slots.client";
import { requireUser } from "@/lib/auth/current";
import { getBadgeCounts } from "@/lib/badges";
import { maybeTickSoon } from "@/lib/cron";
import {
  badgeKeysFor,
  type NavModel,
  navForUser,
  type ResolvedNavItem,
} from "@/lib/nav";
import { findCompany, getFeatureFlags, getSettings } from "@/lib/settings";
import {
  AppShell,
  type ShellNav,
  type ShellNavItem,
} from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { LazyInstallPrompt } from "@/ui/components/lazy";
import { OfflineBanner } from "@/ui/components/OfflineBanner";
import { cx } from "@/ui/cx";
import { OutboxAutoFlush } from "../_components/OutboxAutoFlush";
import { SearchLauncher } from "./_components/SearchLauncher";

// Signed-in shell (SPEC §13; BUILD_PLAN §3.3 F). Everything is resolved on the server
// per request: the user (React cache()), nav from the module manifests filtered by
// permission + flag, and badge counts (best effort: a failing counter shows 0).

const ROLE_LABEL = {
  admin: "Admin",
  office: "Office",
  tech: "Technician",
} as const;

function toShellItem(
  i: ResolvedNavItem,
  match?: readonly string[],
): ShellNavItem {
  return {
    key: i.key,
    // Tab hrefs like "/jobs?mine=1" still activate on "/jobs/…".
    href: i.href,
    label: i.label,
    icon: i.icon,
    ...(i.badge ? { badgeKey: i.badge } : {}),
    ...(match ? { match } : {}),
  };
}

function shellNav(model: NavModel): ShellNav {
  const tabs: ShellNavItem[] = model.tabs.map((t) => {
    const path = t.href.split("?")[0] ?? t.href;
    // Admin "Money" (/payments) also covers invoices and disputes (§13.1).
    const extra =
      t.key === "payments"
        ? ["/invoices", "/disputes", "/pay"]
        : t.key === "messages"
          ? ["/messages"]
          : t.key === "payroll"
            ? ["/pay"]
            : undefined;
    return toShellItem(t, extra ?? (path !== t.href ? [path] : undefined));
  });
  tabs.push({ key: "more", href: "/more", label: "More", icon: "more" });
  const sections = model.sidebar.map((s) => ({
    title: s.label,
    // The sidebar lists only the Settings index; its pages live on /settings.
    items: (s.key === "settings"
      ? s.items.filter((i) => i.key === "settings")
      : s.items
    ).map((i) => toShellItem(i)),
  }));
  return { tabs, sections: sections.filter((s) => s.items.length > 0) };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [flags, company, settings] = await Promise.all([
    getFeatureFlags(),
    findCompany(),
    getSettings(),
  ]);
  const model = navForUser(user, flags);
  const badges = await getBadgeCounts(user, badgeKeysFor(model)).catch(
    () => ({}),
  );
  // Cron piggy-back (SPEC §3.1): throttled to once a minute, runs after the response.
  await maybeTickSoon();

  const brand = settings.branding.app_name || company?.name || "CRM";
  return (
    <AppShell
      user={{
        id: user.id,
        name: user.name,
        roleLabel: ROLE_LABEL[user.baseRole],
      }}
      nav={shellNav(model)}
      // Skeleton titles: page names first (sidebar, More, Settings), short tab labels last.
      titles={[
        ...model.sidebar.flatMap((g) => g.items),
        ...model.more.flatMap((g) => g.items),
        ...model.settings.flatMap((g) => g.items),
        ...model.tabs,
      ].map((i) => ({ href: i.href, label: i.label }))}
      badges={badges as Record<string, number>}
      brand={brand}
      banner={
        <>
          <OfflineBanner />
          <div className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] pt-2 empty:hidden print:hidden">
            <LazyInstallPrompt appName={brand} />
          </div>
        </>
      }
      sidebarFooter={
        <Link
          href="/more"
          className={cx(
            "pressable flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-fill-2",
            // Room for the location badge at the row's right end (QA2 NEW-8).
            user.baseRole === "tech" && "pr-10",
          )}
        >
          <Avatar name={user.name} seed={user.id} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-subhead font-medium">
              {user.name}
            </span>
            <span className="block truncate text-footnote text-label-2">
              {ROLE_LABEL[user.baseRole]} · Account
            </span>
          </span>
        </Link>
      }
    >
      {children}
      {user.baseRole === "tech" && <LocationSharer />}
      <OutboxAutoFlush />
      <SearchLauncher />
    </AppShell>
  );
}
