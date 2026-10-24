"use client";

import { Maximize2, Presentation } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { IconButton } from "@/ui/components/IconButton";
import { cx } from "@/ui/cx";
import { presentationCloses } from "../present-policy";

const KEY = "present";

// Child combinators keep these rules off hubs nested inside (the signature
// pad, a photo): only the presentation's own close button is hidden. In full
// screen a slim top row (Exit presentation · company · Full screen) has its own
// 52 px; the page scrolls below it, so nothing ever renders under the controls.
// Until "Tap to start" the page (and its Approve bar) stays hidden: the start
// screen has one primary.
const ROW = 52;
const CSS = `.present-slot.present-boxed{height:100dvh;overflow:hidden}
.present-slot>.fs-hub[data-fs][data-look]>.fs-x{display:none}
.present-top,.present-start{display:none}
.present-slot .fs-hub[data-fs] .present-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;position:absolute;z-index:3;inset:0 0 auto;height:${ROW}px;padding:0 12px;background:var(--bg);box-shadow:0 .5px 0 var(--sep)}
.present-top>:last-child{justify-self:end}
.present-brand{max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px;font-weight:600;color:var(--label-3)}
.present-exit{justify-self:start;min-height:32px;padding:0 14px;border-radius:9999px;background:var(--fill-2);color:var(--label-2);font-size:13px;font-weight:600;white-space:nowrap}
.present-slot .fs-hub[data-fs] .present-scroll{position:absolute;inset:${ROW}px 0 0;overflow-y:auto;overscroll-behavior:contain}
.present-slot .fs-hub[data-fs] .present-col{max-width:640px;margin:0 auto;padding:4px var(--gutter) 0}
.present-root[data-waiting] .present-scroll{visibility:hidden}
.present-slot .fs-hub[data-fs] .present-start{display:flex;position:absolute;inset:${ROW}px 0 0;z-index:4;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;padding:24px;border:0;background:var(--bg);color:var(--label);text-align:center;cursor:pointer;outline:none}
.present-start:focus-visible .btn{outline:2px solid var(--accent);outline-offset:3px}`;

/**
 * Present mode (/e/…?present=1 on a staff tablet): the customer's own estimate
 * page, unchanged, inside a full-screen hub. A "Tap to start" screen comes
 * first, so the tap that hands the device over also asks for browser full
 * screen (Android and iPad need a user gesture). A discreet "Exit
 * presentation" returns to the staff estimate page. Back pauses the
 * presentation (Resume / Exit); Esc and leaving browser full screen don't end
 * it (see `presentationCloses`).
 */
export function PresentMode({
  children,
  exitHref,
  company,
  heading,
  customer,
  stage,
  preview,
}: {
  children: ReactNode;
  /** The staff estimate page. */
  exitHref: string;
  company: string;
  /** e.g. "Estimate E-1042". */
  heading: string;
  /** The customer's first name ("Prepared for …"). */
  customer?: string | null;
  /** The page's state (e.g. the estimate status): a change scrolls back to the top. */
  stage?: string;
  /** The builder's Preview: no start screen, "Exit preview" goes straight back. */
  preview?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  // The in-page box is the screen while presenting (the hub grows from it).
  const [boxed, setBoxed] = useState(true);
  const [started, setStarted] = useState(!!preview);
  const [canFull, setCanFull] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  useEffect(() => {
    setCanFull(!!document.fullscreenEnabled);
    const sync = () => setIsFull(!!document.fullscreenElement);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (open && !started) startBtn.current?.focus({ preventScroll: true });
  }, [open, started]);

  // Approved (the page refreshed into its next state): show it from the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the stage changes
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [stage]);

  const goFull = () => {
    if (document.fullscreenEnabled && !document.fullscreenElement)
      document.documentElement
        .requestFullscreen?.({ navigationUI: "hide" })
        .catch(() => {});
  };
  const start = () => {
    goFull();
    setStarted(true);
  };
  const resume = () => {
    setBoxed(true);
    setOpen(true);
    goFull();
  };
  const exit = async () => {
    const ok =
      preview ||
      (await confirm({
        title: "Exit presentation?",
        message: "You'll go back to the estimate in the app.",
        confirmLabel: "Exit",
      }));
    if (ok) location.replace(exitHref);
  };

  const onOpenChange = (o: boolean) => {
    if (o) {
      resume();
      return;
    }
    const mine = root.current?.querySelector(".fs-hub");
    const otherHubOpen = [
      ...document.querySelectorAll(".fs-hub[data-fs]"),
    ].some((h) => h !== mine);
    const urlHasKey = new URLSearchParams(location.search).get("fs") === KEY;
    if (presentationCloses({ urlHasKey, otherHubOpen })) setOpen(false);
  };

  return (
    <div
      ref={root}
      className="present-root"
      data-waiting={open && !started ? "" : undefined}
    >
      <style href="present-mode" precedence="default">
        {CSS}
      </style>
      {!open ? (
        <section
          aria-label="Presentation"
          className="sticky top-2 z-10 mb-4 flex items-center gap-2 rounded-card bg-card py-2 pl-4 pr-2 shadow-card"
        >
          <Presentation size={18} aria-hidden className="text-label-2" />
          <span className="min-w-0 flex-1 text-subhead font-medium">
            Presentation paused
          </span>
          <Button size="sm" variant="tinted" onClick={resume}>
            Resume
          </Button>
          <Button size="sm" variant="plain" onClick={exit}>
            Exit
          </Button>
        </section>
      ) : null}
      <FullscreenHub
        title={heading}
        label="Estimate presentation"
        historyKey={KEY}
        chrome="minimal"
        trigger="none"
        open={open}
        onOpenChange={onOpenChange}
        browserFullscreen={false}
        className={cx("present-slot", boxed && "present-boxed")}
        onExit={() => setBoxed(false)}
      >
        <div className="present-top">
          <button type="button" className="present-exit hit-44" onClick={exit}>
            {preview ? "Exit preview" : "Exit presentation"}
          </button>
          <span className="present-brand">{company}</span>
          {canFull && started && !isFull ? (
            <IconButton
              label="Full screen"
              variant="secondary"
              size={30}
              onClick={goFull}
            >
              <Maximize2 size={15} aria-hidden />
            </IconButton>
          ) : (
            <span />
          )}
        </div>
        <div ref={scroller} className="present-scroll">
          <div className="present-col">{children}</div>
        </div>
        {open && !started ? (
          <button
            ref={startBtn}
            type="button"
            className="present-start"
            onClick={start}
            aria-label={`${heading}. Tap to start`}
          >
            <span
              aria-hidden
              className="mb-2 inline-flex size-14 items-center justify-center rounded-[16px] bg-accent-fill text-title2 text-on-accent"
            >
              {company.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-headline text-label-2">{company}</span>
            <span className="text-large-title">{heading}</span>
            {customer ? (
              <span className="text-body text-label-2">
                Prepared for {customer}
              </span>
            ) : null}
            <span className="btn btn-lg btn-primary pointer-events-none mt-8 px-10">
              Tap to start
            </span>
            <span className="mt-3 text-footnote text-label-3">
              Hand the device to your customer
            </span>
          </button>
        ) : null}
        {confirmEl}
      </FullscreenHub>
    </div>
  );
}
