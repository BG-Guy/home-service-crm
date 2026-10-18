import { LogOut, Monitor, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppearanceControl } from "@/app/(app)/_components/AppearanceControl";
import { InstallRow } from "@/app/(app)/_components/InstallRow";
import { NotificationPreferences } from "@/features/notify/slots";
import { PushEnableButton } from "@/features/notify/slots.client";
import {
  MyProfileForm,
  PasswordRow,
  SignOutOthersRow,
} from "@/features/settings/components/ProfileForms";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { getMyProfile, listMySessions } from "@/features/settings/queries";
import { getUserBriefs } from "@/features/team/api";
import { requireUser } from "@/lib/auth/current";
import { findCompany, getSettings } from "@/lib/settings";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { formatRelative } from "@/lib/time";
import { ListRow, ListSection } from "@/ui/components/List";

export const metadata: Metadata = { title: "Profile" };

function deviceName(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /iPhone|Android|Mobile/i.test(ua);
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return { label: `${browser} on ${os}`, mobile };
}

// Settings → Profile (BUILD_PLAN §3.3 B8): own profile, password, devices and
// "sign out other devices", appearance, notification preferences (S35), push (S36)
// and install app. Every signed-in user may open it.
export default async function SettingsProfilePage() {
  const user = await requireUser();
  const [me, sessions, briefs, jar, settings, company] = await Promise.all([
    getMyProfile(user.id),
    listMySessions(user.id, user.sessionId),
    getUserBriefs([user.id]),
    cookies(),
    getSettings(),
    findCompany(),
  ]);
  const theme =
    parseTheme(jar.get(THEME_COOKIE)?.value) ?? settings.ui.default_theme;
  const appName = settings.branding.app_name || company?.name || "CRM";
  const others = sessions.filter((s) => !s.current).length;

  return (
    <SettingsScreen title="Profile">
      <div className="flex flex-col gap-[var(--section-gap)]">
        <MyProfileForm
          name={me?.name ?? user.name}
          email={me?.email ?? user.email}
          phone={me?.phone ?? null}
          avatarUrl={briefs[user.id]?.avatarUrl ?? null}
        />

        <ListSection
          header="Sign-in and devices"
          footer="Lost a phone? Sign out other devices, then change your password."
        >
          <PasswordRow />
          {sessions.slice(0, 6).map((s) => {
            const d = deviceName(s.userAgent);
            return (
              <ListRow
                key={s.id}
                icon={
                  d.mobile ? (
                    <Smartphone size={16} aria-hidden />
                  ) : (
                    <Monitor size={16} aria-hidden />
                  )
                }
                iconTone="gray"
                iconStyle="tinted"
                title={d.label}
                subtitle={
                  s.current
                    ? "This device"
                    : `Active ${formatRelative(s.lastSeenAt)}`
                }
              />
            );
          })}
          <SignOutOthersRow others={others} />
        </ListSection>

        <section id="appearance" className="scroll-mt-24">
          <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
            Appearance
          </h2>
          <div className="rounded-card bg-card p-3">
            <AppearanceControl initial={theme} />
          </div>
          <p className="px-4 pt-1.5 text-footnote text-label-2">
            System follows your phone's light or dark mode.
          </p>
        </section>

        <ListSection
          header="This phone"
          footer="Push notifications on iPhone need the app installed to the Home Screen (iOS 16.4+)."
        >
          <InstallRow appName={appName} />
          <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
            <span className="text-body">Notifications on this device</span>
            <PushEnableButton />
          </div>
        </ListSection>

        <NotificationPreferences userId={user.id} />

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
      </div>
    </SettingsScreen>
  );
}
