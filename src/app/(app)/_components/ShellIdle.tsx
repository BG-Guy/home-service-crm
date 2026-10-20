"use client";

import { useEffect } from "react";
import { startOutbox } from "@/client/outbox";
import { LocationSharer } from "@/features/map/slots.client";
import { InstallPrompt } from "@/ui/components/InstallPrompt";
import { OfflineBanner } from "@/ui/components/OfflineBanner";
import type { ShellIdleProps } from "./ShellDeferred";

/** The idle chunk of the app shell (loaded by `ShellDeferred`). */
export function ShellIdle({ appName, tech }: ShellIdleProps) {
  // Offline outbox auto-flush: app open, `online`, tab visible (src/client/outbox.ts).
  useEffect(() => startOutbox(), []);
  return (
    <>
      <OfflineBanner />
      <div className="print:hidden">
        <InstallPrompt appName={appName} />
      </div>
      {tech && <LocationSharer />}
    </>
  );
}
