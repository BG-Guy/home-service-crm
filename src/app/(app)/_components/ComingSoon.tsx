import { Hammer } from "lucide-react";
import type { ReactNode } from "react";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import {
  type BackTarget,
  LargeTitleHeader,
  NavBar,
} from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";
import { HeaderActions } from "./HeaderActions";

/**
 * Route placeholder used until the owning group builds the screen. Top-level
 * screens get a large title with the global actions; pushed screens (`back`) get
 * an inline nav bar with a back button.
 */
export function ComingSoon({
  title,
  owner,
  back,
  note,
  children,
}: {
  title: string;
  /** Builder group that owns the route (BUILD_PLAN §3.3), e.g. "B1". */
  owner: string;
  back?: BackTarget;
  note?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <PageTransition>
      {back ? (
        <NavBar title={title} back={back} />
      ) : (
        <LargeTitleHeader title={title} trailing={<HeaderActions />} />
      )}
      <Page className={back ? "pt-4" : undefined}>
        <div className="list-card">
          <EmptyState
            icon={<Hammer size={44} strokeWidth={1.6} />}
            title="Coming soon"
            message={note ?? `This screen is being built (owned by ${owner}).`}
          />
        </div>
        {children}
      </Page>
    </PageTransition>
  );
}
