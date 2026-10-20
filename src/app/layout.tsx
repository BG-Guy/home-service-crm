import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type React from "react";
import { getBrandingStyle } from "@/features/settings/api";
import { findCompany, getSettings } from "@/lib/settings";
import {
  dataThemeFor,
  parseTheme,
  THEME_COOKIE,
  themeColorsFor,
} from "@/lib/theme";
import { AppProviders } from "@/ui/providers";
import { ServiceWorkerRegister } from "./_components/ServiceWorkerRegister";
import "./globals.css";

// Root layout (SPEC §12.1, §12.3). Every route renders dynamically (amendment 3):
// it reads the appearance cookie and the company's branding, so nothing touches the
// database at build time.
//  - <html data-theme> comes from the user's Appearance cookie, else settings.ui.default_theme.
//  - The brand accent is server-rendered as a <style> tag (contrast-safe --accent-text).
//  - AppProviders mounts the toast host once for every page (Motion is opt-in per
//    component, see src/ui/motion/MotionProvider.tsx); the
//    signed-in shell adds the offline outbox flush (see (app)/layout.tsx).

// Request-time rendering for every page (no prerender attempt at build, so no DB
// reads at build time — SPEC §15.5 hard rule). Metadata image routes stay static.
export const dynamic = "force-dynamic";

const REVEAL_NOW =
  'try{Object.defineProperty(window,"$RT",{configurable:true,get:function(){},set:function(){}})}catch(e){}';

async function appName(): Promise<string> {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  return settings.branding.app_name || company?.name || "CRM";
}

export async function generateMetadata(): Promise<Metadata> {
  const name = await appName();
  return {
    title: { default: name, template: `%s · ${name}` },
    description: `${name} — jobs, customers, invoices and payments`,
    applicationName: name,
    appleWebApp: {
      capable: true,
      title: name,
      statusBarStyle: "black-translucent",
    },
    formatDetection: { telephone: false },
  };
}

// The browser bar follows the Appearance cookie too, not only the OS (QA T4-17);
// AppearanceControl updates the same <meta> tags on change.
export async function generateViewport(): Promise<Viewport> {
  const [jar, settings] = await Promise.all([cookies(), getSettings()]);
  const pref =
    parseTheme(jar.get(THEME_COOKIE)?.value) ?? settings.ui.default_theme;
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: themeColorsFor(pref),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [jar, settings, brandStyle] = await Promise.all([
    cookies(),
    getSettings(),
    getBrandingStyle(),
  ]);
  const pref =
    parseTheme(jar.get(THEME_COOKIE)?.value) ?? settings.ui.default_theme;
  return (
    <html lang="en" data-theme={dataThemeFor(pref)} suppressHydrationWarning>
      <head>
        <script
          // React's streaming runtime holds each Suspense reveal until 300 ms after
          // the previous one, counting the shell's first frame ($RT). When a frame
          // lands while the HTML is still parsing, the page's content (already in
          // the document) waited 300 ms behind its loading.tsx skeleton: warm LCP
          // 212 -> 492 ms. Keeping $RT unset reveals each boundary on the next frame
          // instead. If React renames the global this does nothing.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static string, no user input
          dangerouslySetInnerHTML={{ __html: REVEAL_NOW }}
        />
        {brandStyle ? (
          <style
            id="brand"
            // Validated hex values only (src/lib/branding.ts) — safe to inline.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: server-generated CSS from validated tokens
            dangerouslySetInnerHTML={{ __html: brandStyle }}
          />
        ) : null}
      </head>
      <body>
        <AppProviders hapticsHack={settings.ui.haptics_hack} outbox={false}>
          {children}
        </AppProviders>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
