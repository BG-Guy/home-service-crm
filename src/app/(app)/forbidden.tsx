import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";

export const metadata: Metadata = { title: "No access" };

// A page under the signed-in shell threw ForbiddenError (requireUser(perm),
// requireAnyPerm, assert*Access) or called forbidden(): HTTP 403, rendered inside the
// shell, nothing logged. The digest wiring is in src/lib/errors.ts.
export default function Forbidden() {
  return (
    <Page className="pt-[calc(env(safe-area-inset-top)+48px)]">
      <div className="list-card">
        <EmptyState
          icon={<Lock size={44} strokeWidth={1.6} />}
          title="You don't have access"
          message="Your role can't open this page. Ask an admin if you need it."
          action={
            <Button variant="tinted" href="/">
              Go home
            </Button>
          }
        />
      </div>
    </Page>
  );
}
