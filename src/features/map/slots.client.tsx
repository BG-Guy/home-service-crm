"use client";

import { LocateFixed, LocateOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/ui/cx";
import type { LocationSharerProps } from "./contracts";

// S53 — mounted by the app shell for techs. While the tech is clocked in, the app is
// open and visible, it watches the position and POSTs /api/location at most every
// `ping_interval_sec` (≥ 60 s). It never runs off shift: the server answers
// `share:false` (clocked out, no monitoring notice, flag off) and the watch stops.

type State = "off" | "sharing" | "denied";
const RECHECK_MS = 3 * 60_000;

/** S53 — Location sharing while clocked in (techs only), with the "Sharing location" pill. */
export function LocationSharer(_props: LocationSharerProps) {
  const [state, setState] = useState<State>("off");
  const [open, setOpen] = useState(false);
  const typing = useTyping();
  const watch = useRef<number | null>(null);
  const interval = useRef(60);
  const lastSent = useRef(0);
  const inflight = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator))
      return;
    let alive = true;
    let recheck: ReturnType<typeof setInterval> | null = null;

    const stop = (next: State = "off") => {
      if (watch.current != null)
        navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
      if (alive) setState(next);
    };

    const send = async (pos: GeolocationPosition) => {
      if (inflight.current) return;
      if (Date.now() - lastSent.current < interval.current * 1000) return;
      inflight.current = true;
      lastSent.current = Date.now();
      try {
        const r = await fetch("/api/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy)
              ? pos.coords.accuracy
              : null,
            heading: Number.isFinite(pos.coords.heading ?? Number.NaN)
              ? pos.coords.heading
              : null,
            speed: Number.isFinite(pos.coords.speed ?? Number.NaN)
              ? pos.coords.speed
              : null,
            at: pos.timestamp,
          }),
        });
        if (r.status === 401 || r.status === 403) return stop();
        const j = (await r.json().catch(() => null)) as {
          share?: boolean;
          intervalSec?: number;
        } | null;
        if (j?.intervalSec) interval.current = j.intervalSec;
        if (j && j.share === false) stop();
      } catch {
        // Offline: the next fix retries; nothing is queued (only live positions matter).
        lastSent.current = 0;
      } finally {
        inflight.current = false;
      }
    };

    const start = () => {
      if (watch.current != null) return;
      watch.current = navigator.geolocation.watchPosition(
        (pos) => void send(pos),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) stop("denied");
        },
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 30_000 },
      );
      setState("sharing");
    };

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/location", { cache: "no-store" });
        if (!r.ok) return stop();
        const j = (await r.json()) as { share: boolean; intervalSec: number };
        interval.current = Math.max(60, j.intervalSec || 60);
        if (j.share) start();
        else stop();
      } catch {
        /* offline: keep the current state */
      }
    };

    const onVisibility = () => {
      // Web limits: only while the app is open and visible.
      if (document.visibilityState === "visible") void check();
      else if (watch.current != null) {
        navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
      }
    };

    void check();
    recheck = setInterval(() => void check(), RECHECK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      if (recheck) clearInterval(recheck);
      document.removeEventListener("visibilitychange", onVisibility);
      if (watch.current != null)
        navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    };
  }, []);

  if (state === "off" || typing) return null;
  const denied = state === "denied";
  const label = denied ? "Location is off" : "Sharing location";
  // A compact status badge on the floating tab bar's top-right corner: chrome,
  // not content, so it never covers a row's right edge (pages pad their bottom to
  // clear the bar). On desktop it sits at the end of the sidebar's account row.
  // Tap to expand. Hidden while typing (on-screen keyboard). QA T1-20, QA2 NEW-8.
  return (
    <div className="pointer-events-none fixed right-[calc(max(var(--gutter),(100vw-420px)/2)-12px)] bottom-[calc(max(12px,env(safe-area-inset-bottom)-6px)+var(--tabbar-h)-12px)] z-[45] print:hidden lg:right-auto lg:bottom-[calc(env(safe-area-inset-bottom)+25px)] lg:left-[calc(var(--sidebar-w)-44px)]">
      {open && (
        <output className="material pointer-events-auto absolute right-0 bottom-full mb-3 w-[min(260px,calc(100vw-32px))] rounded-card p-3 text-footnote text-label shadow-card lg:right-auto lg:left-0">
          <span className="mb-1 block font-semibold">{label}</span>
          {denied
            ? "Dispatch can’t see where you are. Allow location for this app in your phone’s settings."
            : "While you’re clocked in and the app is open, dispatch sees your position about once a minute. It stops when you clock out."}
        </output>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={cx(
          "material hit-44 pointer-events-auto flex size-6 items-center justify-center rounded-full shadow-card",
          denied ? "text-[var(--sys-orange)]" : "text-label",
        )}
      >
        {denied ? (
          <LocateOff aria-hidden size={14} />
        ) : open ? (
          <LocateFixed
            aria-hidden
            size={14}
            className="text-[var(--sys-green)]"
          />
        ) : (
          <span aria-hidden className="relative flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--sys-green)] opacity-60 motion-reduce:animate-none" />
            <span className="relative size-2.5 rounded-full bg-[var(--sys-green)]" />
          </span>
        )}
      </button>
    </div>
  );
}

/** True while a text field has focus (the on-screen keyboard is likely up). */
function useTyping(): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.isContentEditable ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement &&
          ![
            "button",
            "checkbox",
            "radio",
            "submit",
            "reset",
            "file",
            "range",
          ].includes(el.type)));
    const onIn = (e: FocusEvent) => setTyping(isField(e.target));
    const onOut = () => setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}
