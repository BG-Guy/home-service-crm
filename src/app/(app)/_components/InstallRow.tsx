"use client";

import { LazyInstallPrompt } from "@/ui/components/lazy";

/** "Install app" row for the More list (hidden once installed). */
export function InstallRow({ appName }: { appName: string }) {
  return <LazyInstallPrompt variant="row" appName={appName} />;
}
