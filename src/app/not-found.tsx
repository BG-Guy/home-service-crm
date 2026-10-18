import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center px-[var(--gutter)]"
    >
      <div className="list-card w-full max-w-[420px]">
        <EmptyState
          icon={<Compass size={44} strokeWidth={1.6} />}
          title="Page not found"
          message="The link may be wrong or the page was moved."
          action={<Button href="/">Go home</Button>}
        />
      </div>
    </main>
  );
}
