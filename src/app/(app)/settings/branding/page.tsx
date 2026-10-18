import type { Metadata } from "next";
import { getMediaUrls } from "@/features/media/api";
import { BrandingForm } from "@/features/settings/components/BrandingForm";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { requireUser } from "@/lib/auth/current";
import { getCompany, getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Branding" };

// Settings → Branding (SPEC M21): accent color with live preview and a contrast
// check (auto-derived --accent-text), logos, app name, invoice header style.
export default async function SettingsBrandingPage() {
  await requireUser("settings.manage");
  const [c, s] = await Promise.all([getCompany(), getSettings()]);
  const ids = [c.logoMediaId, s.branding.logo_dark_media_id].filter(
    (x): x is string => !!x,
  );
  const urls = ids.length
    ? await getMediaUrls(ids, "full").catch(
        () => ({}) as Record<string, string>,
      )
    : {};
  return (
    <SettingsScreen
      title="Branding"
      intro="Make the app look like your business: brand color, logo and name."
    >
      <BrandingForm
        companyName={c.name}
        logoUrl={c.logoMediaId ? (urls[c.logoMediaId] ?? null) : null}
        logoDarkUrl={
          s.branding.logo_dark_media_id
            ? (urls[s.branding.logo_dark_media_id] ?? null)
            : null
        }
        initial={{
          accentColor: s.branding.accent_color,
          appName: s.branding.app_name ?? "",
          invoiceHeaderStyle: s.branding.invoice_header_style,
          defaultTheme: s.ui.default_theme,
        }}
      />
    </SettingsScreen>
  );
}
