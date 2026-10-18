import type { ReactNode } from "react";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/** Chrome for B4's pushed settings screens (back to /settings, gutters, intro). */
export function SettingsShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageTransition>
      <NavBar title={title} back={{ href: "/settings", label: "Settings" }} />
      <Page className="pt-4">
        {intro && (
          <p className="mb-5 px-4 text-subhead text-label-2">{intro}</p>
        )}
        <div className="flex flex-col gap-[var(--section-gap)]">{children}</div>
      </Page>
    </PageTransition>
  );
}
