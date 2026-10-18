"use client";

import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { flush, useOutboxState } from "@/client/outbox";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Floating sync-status capsule (SPEC §12.6): offline + pending count, syncing
 * progress, or a retry when the last sync failed. Hidden when all is well.
 * Sits above the tab bar on phones, bottom-center on desktop.
 */
export function OfflineBanner({ className }: { className?: string }) {
  const s = useOutboxState();
  let body: ReactNode = null;
  if (!s.online) {
    body = (
      <>
        <WifiOff aria-hidden size={16} />
        <span>
          Offline
          {s.pending > 0 && ` · ${plural(s.pending, "change")} will sync`}
        </span>
      </>
    );
  } else if (s.syncing && s.pending > 0) {
    body = (
      <>
        <Spinner size={15} />
        <span>Syncing {plural(s.pending, "change")}…</span>
      </>
    );
  } else if (s.uploading > 0) {
    body = (
      <>
        <Spinner size={15} />
        <span>Uploading {plural(s.uploading, "photo")}…</span>
      </>
    );
  } else if (s.pending > 0 && s.lastError) {
    body = (
      <>
        <CircleAlert aria-hidden size={16} className="shrink-0 text-danger" />
        {/* The reason too: a server problem must not read like "offline" (QA T1-01). */}
        <span className="min-w-0">
          {plural(s.pending, "change")} not synced
          <span className="block text-caption text-label-2">{s.lastError}</span>
        </span>
        <button
          type="button"
          onClick={() => void flush()}
          className="-my-2 -mr-2 flex min-h-11 items-center gap-1 rounded-pill px-2.5 font-semibold text-accent-text"
        >
          <RefreshCw aria-hidden size={14} />
          Retry
        </button>
      </>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fixed live region, not a form output
    <div
      role="status"
      aria-live="polite"
      data-chrome
      className={cx(
        "pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-space)+4px)] z-[var(--z-toast)] flex justify-center px-4 lg:bottom-6",
        className,
      )}
    >
      {body && (
        <div className="enter-fade-up material pointer-events-auto flex min-h-9 items-center gap-2 rounded-pill px-4 py-1.5 text-footnote font-medium shadow-[var(--shadow-float),0_0_0_0.5px_var(--sep)]">
          {body}
        </div>
      )}
    </div>
  );
}
