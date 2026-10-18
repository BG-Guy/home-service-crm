import type { ReactNode } from "react";
import { Page } from "@/ui/components/AppShell";
import { type BackTarget, NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/**
 * Chrome for a pushed settings screen: inline nav bar with a back button to
 * /settings (iOS needs it in standalone PWAs), page gutters, optional intro text.
 */
export function SettingsScreen({
  title,
  intro,
  back = { href: "/settings", label: "Settings" },
  trailing,
  children,
  wide,
}: {
  title: string;
  intro?: ReactNode;
  back?: BackTarget;
  trailing?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <PageTransition>
      <NavBar title={title} back={back} trailing={trailing} />
      <Page wide={wide} className="pt-4">
        {intro && (
          <p className="mb-5 px-4 text-subhead text-label-2">{intro}</p>
        )}
        {children}
      </Page>
    </PageTransition>
  );
}
