"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";

// Error boundary for the signed-in app. Server error details are redacted in
// production. Permission denials never land here: ForbiddenError renders
// ./forbidden.tsx (403) instead.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Page className="pt-[calc(env(safe-area-inset-top)+48px)]">
      <div className="list-card">
        <EmptyState
          icon={<TriangleAlert size={44} strokeWidth={1.6} />}
          title="Can't open this page"
          message="Something went wrong on our side. Try again in a moment."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="tinted" onClick={reset}>
                Try again
              </Button>
              <Button variant="gray" href="/">
                Go home
              </Button>
            </div>
          }
        />
      </div>
      {error.digest && (
        <p className="mt-3 text-center text-footnote text-label-3">
          Reference {error.digest}
        </p>
      )}
    </Page>
  );
}
