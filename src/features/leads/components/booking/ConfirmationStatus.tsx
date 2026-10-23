"use client";

import { useEffect, useState } from "react";
import { toneStyle } from "@/ui/tone";
import { fetchBookingStatus } from "../../booking-actions";
import type { ConfirmationLabel } from "../../booking-labels";

/**
 * The Done screen's confirmation line. The screen renders at once with what the
 * server knew; this fills in after: it polls briefly while a confirmation is on
 * its way, and checks again whenever the page comes back into view (a tech
 * assigned in the hub sends it).
 */
export function ConfirmationStatus({
  jobId,
  initial,
}: {
  jobId: string;
  initial: ConfirmationLabel;
}) {
  const [label, setLabel] = useState(initial);
  // A server refresh may bring a newer state: adopt it (during render, no effect).
  const sig = `${initial.text}|${initial.tone}|${initial.settled}`;
  const [seen, setSeen] = useState(sig);
  if (sig !== seen) {
    setSeen(sig);
    setLabel(initial);
  }
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const poll = async () => {
      const next = await fetchBookingStatus(jobId).catch(() => null);
      if (stop || !next) return;
      setLabel(next);
      if (!next.settled && ++tries < 10) timer = setTimeout(poll, 1500);
    };
    if (!initial.settled) timer = setTimeout(poll, 600);
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void poll();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [jobId, initial.settled]);
  return (
    <output
      aria-live="polite"
      className="tint-bg tint-fg max-w-full rounded-[12px] px-3 py-1.5 text-center text-footnote font-semibold text-balance"
      style={toneStyle(label.tone)}
    >
      {label.text}
    </output>
  );
}
