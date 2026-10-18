"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/ui/components/Button";

// Screen-only toolbar for the print pages (invoice, estimate, statement, receipt):
// "Download PDF" is the browser's print dialog (SPEC M08) — no PDF library ships.

export function PrintBar({
  backHref,
  backLabel = "Back",
  autoPrint = false,
  title,
}: {
  backHref?: string;
  backLabel?: string;
  autoPrint?: boolean;
  title?: string;
}) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint]);
  return (
    <div
      data-chrome
      className="material hairline-b sticky top-0 z-[var(--z-bar)] pt-[env(safe-area-inset-top)] print:hidden"
    >
      <div className="mx-auto flex min-h-11 max-w-[var(--content-max)] items-center justify-between gap-2 px-[var(--gutter)] py-1.5">
        {backHref ? (
          <Button href={backHref} variant="plain" size="sm">
            ‹ {backLabel}
          </Button>
        ) : (
          <span />
        )}
        {title ? <span className="truncate text-headline">{title}</span> : null}
        <Button
          size="sm"
          icon={<Printer size={17} aria-hidden />}
          onClick={() => window.print()}
        >
          Print / PDF
        </Button>
      </div>
    </div>
  );
}
