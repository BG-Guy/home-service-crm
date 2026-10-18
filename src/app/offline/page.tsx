import type { Metadata } from "next";
import { BrandMark } from "../_components/BrandMark";
import { RetryButton } from "./RetryButton";

export const metadata: Metadata = { title: "Offline" };

// Offline fallback (SPEC §12.3): precached by /sw.js and served for navigations
// when the network is unreachable. Keep it self-contained (no data fetching).
export default function OfflinePage() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center px-[var(--gutter)] text-center"
    >
      <BrandMark size={64} className="mb-6" />
      <h1 className="text-title1 font-bold tracking-tight">You're offline</h1>
      <p className="mt-2 max-w-[32ch] text-body text-label-2">
        This page isn't available without a connection. Anything you saved
        offline will sync when you're back online.
      </p>
      <RetryButton />
    </main>
  );
}
