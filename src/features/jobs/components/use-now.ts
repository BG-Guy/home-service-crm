import { useEffect, useState } from "react";

/**
 * "Now" for relative times in client components: the server's render time until
 * mount (so "3 min ago" hydrates identically, QA T1-13), then the device clock,
 * ticking once a minute.
 */
export function useNow(renderedAt: number): [number, () => void] {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return [now, () => setNow(Date.now())];
}

/** Relative-time input clamped to `now` (a just-saved item never reads "in 2 sec"). */
export const atOrBefore = (iso: string, now: number) =>
  Math.min(new Date(iso).getTime(), now);
