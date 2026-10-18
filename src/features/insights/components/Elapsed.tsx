"use client";

import { useEffect, useState } from "react";
import { Pill } from "@/ui/components/StatusPill";

/**
 * Speed-to-lead timer (SPEC M04 colors): green < 5 min, amber < SLA, red beyond.
 * Ticks every 30 s; renders the server value first (no hydration mismatch).
 */
export function Elapsed({
  since,
  serverNow,
  slaMinutes,
}: {
  since: string;
  serverNow: string;
  slaMinutes: number;
}) {
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(
    0,
    Math.floor((now - new Date(since).getTime()) / 60_000),
  );
  const tone = mins < 5 ? "green" : mins < slaMinutes ? "orange" : "red";
  const text =
    mins < 60
      ? `${mins} min`
      : mins < 1440
        ? `${Math.floor(mins / 60)} h ${mins % 60} m`
        : `${Math.floor(mins / 1440)} d`;
  return (
    <Pill tone={tone} size="sm">
      <span className="num">{text}</span>
    </Pill>
  );
}
