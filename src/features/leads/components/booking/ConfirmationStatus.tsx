"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";

/**
 * The booking confirmation is enqueued by the automation engine right after the
 * booking commits (events run in `after()`), so the done page may render before
 * it exists. Refresh a few times until the real row shows up.
 */
export function ConfirmationPoll({ settled }: { settled: boolean }) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (settled || tries >= 6) return;
    const t = setTimeout(() => {
      setTries((n) => n + 1);
      startTransition(() => router.refresh());
    }, 1200);
    return () => clearTimeout(t);
  }, [settled, tries, router]);
  return null;
}
