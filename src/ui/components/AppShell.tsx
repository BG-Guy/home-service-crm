import type { ReactNode } from "react";
import { cx } from "../cx";
import { iconFor } from "../icons";
import { type NavTitle, uniqueTitles } from "./nav-titles";
import { NavTitlesProvider } from "./nav-titles-context";
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

// No Avatar import here: client code imports `Page` from this module, and every
// import of it would ride along into those chunks.
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * App chrome (Server Component): floating TabBar below 1024 px, Sidebar at
 * ≥ 1024 px, skip link, and a `<main>` that clears the tab bar. Data comes in
 * as props — the integrator resolves permissions/flags/badges in the
 * `(app)/layout.tsx` and passes plain values.
 *
 * The banner and `<main>` sit in `.shell-stage`, the layer that scales back
 * behind a large phone sheet (M4 card stack). Fixed-position chrome (sync
 * capsule, install nudge, location pill) goes in `overlays`, outside that layer,
 * so it never moves with it.
 *
 * ```tsx
 * <AppShell user={{ id, name, roleLabel }} nav={nav} badges={{ "leads.new": 3 }}
 *   brand={company.name} overlays={<ShellDeferred />}>{children}</AppShell>
 * ```
 */
export function AppShell({
  user,
  nav,
  badges = {},
  criticalBadges = CRITICAL_BADGES,
  brand,
  banner,
  overlays,
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
  /** In-flow banner slot above page content. */
  banner?: ReactNode;
  /** Fixed-position overlays (e.g. `<OfflineBanner />`), outside the scaling stage. */
  overlays?: ReactNode;
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
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill text-footnote font-semibold"
              >
                {initialsOf(user.name)}
              </span>
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
      <div className="shell-stage min-w-0">
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
        </main>
      </div>
      <TabBar
        className="lg:hidden"
        items={nav.tabs.slice(0, 5).map((t) => toTab(t, 24))}
      />
      {overlays}
    </div>
  );
}

/**
 * Page content container: side gutters (16 / 24 at ≥ 768 / 32 at ≥ 1200), max
 * width 1200 px (`wide` for the schedule board and map), bottom spacing.
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
 * Detail page layout (docs/DESIGN.md §6). At ≥ 1200 px: two columns,
 * `minmax(0,1fr) 360px`, the right rail sticky under the nav bar. Below that the
 * columns stack: main, then the rail cards (or none, `railOnPhone="hide"`), and
 * `bar` becomes the sticky bottom action bar, last in the flow so it never
 * covers content. On desktop `bar` is the first card of the rail.
 *
 * ```tsx
 * <DetailLayout
 *   rail={<><StatusCard /><MoneyCard /><TechCard … /></>}
 *   bar={<BottomBar summary={<BarSummary title="$334.54" subtitle="Balance" />}
 *          action={<Button>Collect</Button>} />}>
 *   <Hero /> <Tabs />
 * </DetailLayout>
 * ```
 * Server Component (no JS). Put it inside `<Page>`.
 */
export function DetailLayout({
  children,
  rail,
  bar,
  railOnPhone = "stack",
  railLabel = "Summary",
  className,
}: {
  /** Main column (hero, tabs, content). */
  children: ReactNode;
  /** Right-rail cards on desktop (status, next action, money, people). */
  rail?: ReactNode;
  /** A `<BottomBar>`: sticky bottom bar on phone, first rail card on desktop. */
  bar?: ReactNode;
  /** Below 1200 px the rail cards stack under main (`stack`) or hide (`hide`). */
  railOnPhone?: "stack" | "hide";
  /** Accessible name of the rail (`<aside>`). */
  railLabel?: string;
  className?: string;
}) {
  return (
    <div className={cx("detail-layout", className)}>
      <div className="detail-main">{children}</div>
      {rail || bar ? (
        <aside className="detail-rail" aria-label={railLabel}>
          <div className="detail-rail-in">
            {bar}
            {rail ? (
              <div className="detail-rail-body" data-phone={railOnPhone}>
                {rail}
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
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
        // Narrow-pane marker: header create buttons switch to compact icons inside it.
        data-pane
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
