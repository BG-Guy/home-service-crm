"use client";

import { useEffect, useState } from "react";
import { cx } from "@/ui/cx";

/** Live "for 34 min" response timer; red once past the target. */
export function Elapsed({
  since,
  targetMinutes,
  prefix = "Waiting",
}: {
  since: string;
  targetMinutes: number;
  prefix?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.max(
    0,
    Math.floor((now - new Date(since).getTime()) / 60_000),
  );
  const text =
    min < 60
      ? `${min} min`
      : min < 48 * 60
        ? `${Math.floor(min / 60)} h ${min % 60} min`
        : `${Math.floor(min / 1440)} days`;
  return (
    <span
      className={cx(
        "num text-footnote font-medium",
        min > targetMinutes ? "text-danger" : "text-label-2",
      )}
      suppressHydrationWarning
    >
      {prefix} {text}
    </span>
  );
}
