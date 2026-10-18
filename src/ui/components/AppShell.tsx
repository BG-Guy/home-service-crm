import { type ReactNode, Suspense } from "react";
import { cx } from "../cx";
import { iconFor } from "../icons";
import { Avatar } from "./Avatar";
import { HistoryTracker } from "./NavHistory";
import { NavTitlesProvider } from "./NavTitles";
import { type NavTitle, uniqueTitles } from "./nav-titles";
import { Sidebar } from "./Sidebar";
import { TabBar, type TabItem } from "./TabBar";

/** A nav entry as the integrator builds it from module manifests (SPEC §15.1 `nav.ts`). */
export interface ShellNavItem {
  key: string;
  href: string;
  label: string;
  /** Icon name from `src/ui/icons.ts` (unknown names fall back to a dot). */
  icon: string;
  /** Key into `badges` (BUILD_PLAN Appendix D), e.g. "leads.new". */
  badgeKey?: string;
  /** Extra active-path prefixes. */
  match?: readonly string[];
}

export interface ShellNav {
  /** Mobile tab bar, ≤ 5 (the last is usually "More" → /more). */
  tabs: readonly ShellNavItem[];
  /** Desktop sidebar sections (SPEC §13.2). */
  sections: readonly { title?: string; items: readonly ShellNavItem[] }[];
}

export interface ShellUser {
  id: string;
  name: string;
  /** E.g. "Office" or the role name. */
  roleLabel?: string;
  avatarUrl?: string | null;
}

/** Badge keys that render red (BUILD_PLAN Appendix D). */
export const CRITICAL_BADGES: readonly string[] = ["disputes.open"];

/**
 * App chrome (Server Component): floating TabBar below 1024 px, Sidebar at
 * ≥ 1024 px, skip link, and a `<main>` that clears the tab bar. Data comes in
 * as props — the integrator resolves permissions/flags/badges in the
 * `(app)/layout.tsx` and passes plain values.
 *
 * ```tsx
 * <AppShell user={{ id, name, roleLabel }} nav={nav} badges={{ "leads.new": 3 }}
 *   brand={company.name} banner={<OfflineBanner />}>{children}</AppShell>
 * ```
 */
export function AppShell({
  user,
  nav,
  badges = {},
  criticalBadges = CRITICAL_BADGES,
  brand,
  banner,
  sidebarFooter,
  titles,
  children,
}: {
  user: ShellUser;
  nav: ShellNav;
  badges?: Readonly<Record<string, number>>;
  criticalBadges?: readonly string[];
  /** Company name or logo node for the sidebar header. */
  brand?: ReactNode;
  /** Global banner slot above page content (e.g. `<OfflineBanner />`). */
  banner?: ReactNode;
  /** Replaces the default user row at the bottom of the sidebar. */
  sidebarFooter?: ReactNode;
  /**
   * Screen titles by path for `loading.tsx` skeletons (best label first).
   * Defaults to the sidebar items, then the tabs.
   */
  titles?: readonly NavTitle[];
  children: ReactNode;
}) {
  const toTab = (it: ShellNavItem, size: number): TabItem => {
    const Icon = iconFor(it.icon);
    return {
      key: it.key,
      href: it.href,
      label: it.label,
      match: it.match,
      icon: <Icon size={size} strokeWidth={1.9} />,
      badge: it.badgeKey ? (badges[it.badgeKey] ?? 0) : undefined,
      critical: it.badgeKey ? criticalBadges.includes(it.badgeKey) : false,
    };
  };

  return (
    // `.app-shell`: the print stylesheet drops the grid, so at ≥ 1024 px the
    // document isn't squeezed into the hidden sidebar's column (QA2 NEW-14).
    <div className="app-shell min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-[var(--z-toast)] rounded-control bg-card px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <Sidebar
        className="hidden lg:flex"
        sections={nav.sections.map((s) => ({
          title: s.title,
          items: s.items.map((it) => toTab(it, 20)),
        }))}
        header={
          brand ? (
            <div className="truncate text-title3 font-bold tracking-tight">
              {brand}
            </div>
          ) : undefined
        }
        footer={
          sidebarFooter ?? (
            <div className="flex items-center gap-3 px-2">
              <Avatar
                name={user.name}
                src={user.avatarUrl}
                seed={user.id}
                size={32}
              />
              <div className="min-w-0">
                <div className="truncate text-subhead font-medium">
                  {user.name}
                </div>
                {user.roleLabel && (
                  <div className="truncate text-footnote text-label-2">
                    {user.roleLabel}
                  </div>
                )}
              </div>
            </div>
          )
        }
      />
      <div className="min-w-0">
        {banner}
        <main
          id="main"
          tabIndex={-1}
          className="pb-[var(--tabbar-space)] outline-none"
        >
          <NavTitlesProvider
            titles={uniqueTitles(
              titles ?? [...nav.sections.flatMap((s) => s.items), ...nav.tabs],
            )}
          >
            {children}
          </NavTitlesProvider>
          {/* The pages this tab visits, for the history breadcrumbs. */}
          <Suspense fallback={null}>
            <HistoryTracker userId={user.id} />
          </Suspense>
        </main>
      </div>
      <TabBar
        className="lg:hidden"
        items={nav.tabs.slice(0, 5).map((t) => toTab(t, 24))}
      />
    </div>
  );
}

/**
 * Page content container: side gutters (16/20 px), max width 1100 px
 * (`wide` for the schedule board and map), bottom spacing.
 */
export function Page({
  children,
  wide,
  className,
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-[var(--gutter)] pb-8",
        !wide && "max-w-[var(--content-max)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * List–detail split for Customers/Jobs/Leads on desktop (SPEC §12.4): a 360 px
 * list column + detail. On mobile only one pane shows: the detail when
 * `showDetail`, otherwise the list.
 */
export function SplitView({
  list,
  detail,
  showDetail,
}: {
  list: ReactNode;
  detail: ReactNode;
  showDetail: boolean;
}) {
  return (
    <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
      <div
        className={cx(
          "lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto lg:overscroll-contain lg:shadow-[inset_-0.5px_0_0_var(--sep)]",
          showDetail && "hidden",
        )}
      >
        {list}
      </div>
      <div className={cx("min-w-0", !showDetail && "hidden lg:block")}>
        {detail}
      </div>
    </div>
  );
}
