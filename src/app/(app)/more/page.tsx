import { LogOut, Palette } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/current";
import { getBadgeCounts } from "@/lib/badges";
import { badgeKeysFor, navForUser } from "@/lib/nav";
import { findCompany, getFeatureFlags, getSettings } from "@/lib/settings";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { CRITICAL_BADGES, Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { iconFor } from "@/ui/icons";
import { PageTransition } from "@/ui/motion/PageTransition";
import { type Tone, toneStyle } from "@/ui/tone";
import { AppearanceControl } from "../_components/AppearanceControl";
import { HeaderActions } from "../_components/HeaderActions";
import { InstallRow } from "../_components/InstallRow";

export const metadata: Metadata = { title: "More" };

const ROLE_LABEL = {
  admin: "Admin",
  office: "Office",
  tech: "Technician",
} as const;

// iOS Settings-style tile colors per More group (§13.1).
const GROUP_TONE: Record<string, Tone> = {
  work: "blue",
  team: "indigo",
  fleet: "orange",
  insights: "purple",
  account: "gray",
  admin: "gray",
};

// More (SPEC §13.1): the grouped list of everything that isn't a tab, filtered by
// permission and feature flag, plus Appearance, Install app and Sign out.
export default async function MorePage() {
  const user = await requireUser();
  const [flags, company, settings, jar] = await Promise.all([
    getFeatureFlags(),
    findCompany(),
    getSettings(),
    cookies(),
  ]);
  const model = navForUser(user, flags);
  const badges = await getBadgeCounts(user, badgeKeysFor(model)).catch(
    () => ({}) as Record<string, number>,
  );
  const theme =
    parseTheme(jar.get(THEME_COOKIE)?.value) ?? settings.ui.default_theme;
  const appName = settings.branding.app_name || company?.name || "CRM";

  return (
    <PageTransition>
      <LargeTitleHeader title="More" trailing={<HeaderActions />} />
      <Page>
        <ListGroup>
          <ListSection>
            <ListRow
              leading={<Avatar name={user.name} seed={user.id} size={44} />}
              title={<span className="text-headline">{user.name}</span>}
              subtitle={`${ROLE_LABEL[user.baseRole]} · Your profile`}
              href={`/team/${user.id}`}
            />
          </ListSection>

          {model.more.map((group) => {
            const tone = GROUP_TONE[group.key] ?? "blue";
            const rows = group.items.flatMap((item) => {
              const Icon = iconFor(item.icon);
              if (item.action === "signout") return [];
              if (item.action === "install")
                return [<InstallRow key={item.key} appName={appName} />];
              if (item.key === "account.appearance")
                return [
                  <div
                    key={item.key}
                    className="flex min-h-11 items-center gap-3 px-4 py-2"
                  >
                    <span
                      aria-hidden
                      className="tone-bg flex size-[29px] shrink-0 items-center justify-center rounded-[7px]"
                      style={toneStyle("indigo")}
                    >
                      <Palette size={17} />
                    </span>
                    <span className="flex-1 text-body">Appearance</span>
                    <AppearanceControl initial={theme} />
                  </div>,
                ];
              const count = item.badge ? (badges[item.badge] ?? 0) : 0;
              return [
                <ListRow
                  key={item.key}
                  icon={<Icon size={17} aria-hidden />}
                  iconTone={tone}
                  title={item.label}
                  href={item.href}
                  accessory={count > 0 ? "badge" : "chevron"}
                  badge={count}
                  badgeCritical={
                    item.badge ? CRITICAL_BADGES.includes(item.badge) : false
                  }
                />,
              ];
            });
            if (rows.length === 0) return null;
            return (
              <ListSection key={group.key} header={group.label}>
                {rows}
              </ListSection>
            );
          })}

          <form action="/api/auth/logout" method="post">
            <ListSection>
              <button
                type="submit"
                className="row-press flex min-h-11 w-full items-center justify-center gap-2 px-4 py-[11px] text-body text-danger"
              >
                <LogOut aria-hidden size={18} />
                Sign out
              </button>
            </ListSection>
          </form>
          <p className="px-4 text-center text-footnote text-label-2">
            {appName}
          </p>
        </ListGroup>
      </Page>
    </PageTransition>
  );
}
