import type { ReactNode } from "react";
import { Page } from "@/ui/components/AppShell";
import { type BackTarget, NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

/** Pushed settings screen chrome (B1 copy of the settings pattern; back → /settings). */
export function Screen({
  title,
  intro,
  back = { href: "/settings", label: "Settings" },
  trailing,
  children,
}: {
  title: string;
  intro?: ReactNode;
  back?: BackTarget;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageTransition>
      <NavBar title={title} back={back} trailing={trailing} />
      <Page className="pt-4">
        {intro && (
          <p className="mb-5 px-4 text-subhead text-label-2">{intro}</p>
        )}
        {children}
      </Page>
    </PageTransition>
  );
}
