"use client";

import { type ReactNode, useEffect } from "react";
import { initInstallPrompt } from "@/client/install-prompt";
import { Toaster } from "./components/Toast";
import { setHapticsHack } from "./motion/haptics";

/**
 * Mount once in the root layout's `<body>` (INTEGRATOR):
 * - passive `touchstart` on document (so `:active` fires on iOS, SPEC §12.2)
 * - Toaster (toast host)
 * Motion is NOT mounted here (~30 KB gz): components that render `m.*` wrap their
 * own subtree in `<MotionProvider>` (src/ui/motion/MotionProvider.tsx).
 * - `beforeinstallprompt` capture, outbox auto-flush (lazy chunk), haptics flag.
 *
 * ```tsx
 * <body><AppProviders hapticsHack={settings.ui.haptics_hack}>{children}</AppProviders></body>
 * ```
 */
export function AppProviders({
  children,
  hapticsHack = false,
  outbox = true,
}: {
  children: ReactNode;
  /** `settings.ui.haptics_hack` (iOS switch haptic trick). */
  hapticsHack?: boolean;
  /** Start the offline outbox auto-flush (signed-in app only). */
  outbox?: boolean;
}) {
  useEffect(() => {
    initInstallPrompt();
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  useEffect(() => {
    setHapticsHack(hapticsHack);
  }, [hapticsHack]);
  useEffect(() => {
    if (!outbox) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("@/client/outbox").then((m) => {
      if (!cancelled) stop = m.startOutbox();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [outbox]);
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
