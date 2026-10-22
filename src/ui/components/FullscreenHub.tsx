"use client";

import { Maximize2, Minimize2, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { lockScroll as lockPageScroll } from "./dialog-utils";
import { IconButton } from "./IconButton";

/**
 * Full-screen mode for a hub region (DESIGN.md "Fullscreen hub (M19)"): a map,
 * a timeline, a board, a signing pad, a photo viewer. The region's own subtree
 * stays mounted (no portal): the hub element moves to the top layer
 * (`popover="manual"`), which escapes every transformed or contained ancestor,
 * so a Leaflet map keeps its instance and tiles. It grows from its on-screen
 * rect (FLIP, 320 ms spring; a fade with reduced motion), pushes `?fs=<key>` so
 * back closes it, makes the rest of the app inert, and on touch devices also asks
 * for real browser full screen. Sheets opened from inside still stack above it,
 * and so do toasts (`[data-fs-top]` overlays join the top layer after it).
 *
 * ```tsx
 * <FullscreenHub title="Thu, Oct 22 · Map" historyKey="map" controls={…}
 *   className="h-80" onResize={() => map.invalidateSize()}>
 *   <Map />
 * </FullscreenHub>
 * ```
 */
export interface FullscreenHubProps {
  /** The region. Mounted once, in both states. */
  children: ReactNode;
  /** Top-bar title and the dialog's name (pass `label` when it isn't text). */
  title: ReactNode;
  label?: string;
  subtitle?: ReactNode;
  /** Top-bar slot: filters, day arrows. Wraps under the title on narrow screens. */
  controls?: ReactNode;
  /** Bottom slot: actions such as Done or Clear. */
  footer?: ReactNode;
  /** `bar`: glass top bar (default). `minimal`: only a floating close button. */
  chrome?: "bar" | "minimal";
  /** Where the default trigger shows: `touch` (< 1200 px, default) or `all`. */
  breakpoint?: "touch" | "all";
  /** `corner` (glass Expand button, default), `none` (controlled), or your own. */
  trigger?: "corner" | "none" | ((open: () => void) => ReactNode);
  corner?: "top-right" | "top-left";
  /** Controlled state; leave out for an internal one (`defaultOpen`). */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * `?fs=<historyKey>` while open (default: unique per instance). Also the name
   * `openFullscreen(key)` opens it by, e.g. from a header button.
   */
  historyKey?: string;
  /** One-time "Rotate for a wider view" tip in portrait on phones. */
  orientationHint?: "landscape";
  /** Lock page scroll (default). `strict` also stops overscroll / pull-to-refresh. */
  lockScroll?: boolean | "strict";
  /** Ask for browser full screen: default on touch devices only. */
  browserFullscreen?: boolean;
  /** A dark surface whatever the app theme (photos, wall mode), map tiles included. */
  theme?: "dark";
  onEnter?: () => void;
  onExit?: () => void;
  /** The region changed size (enter, exit, rotation): e.g. `map.invalidateSize()`. */
  onResize?: () => void;
  /** Classes for the in-page slot (its size and place in the layout). */
  className?: string;
  bodyClassName?: string;
  expandLabel?: string;
  closeLabel?: string;
}

// The dark theme (tokens and the Leaflet tile inversion) applies only while open,
// so the region keeps the app theme in the page. In a dark app the tiles already
// carry the same filter (globals.css), so they never invert twice. Bar, footer,
// close and hint rules use `>` so a hub nested in another keeps its own state;
// the body is isolated so the close button and the hint stay above its content.
const CSS = `@layer components{.fs-slot{position:relative}}
.fs-hub{position:relative;inset:auto;display:flex;flex-direction:column;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:visible;color:inherit;background:none}
.fs-hub[data-fs]{position:fixed;inset:0;z-index:45;height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);background:var(--bg);color:var(--label);overflow:hidden;overscroll-behavior:none}
.fs-hub::backdrop{background:none}
.fs-body{position:relative;flex:1 1 auto;min-height:0;isolation:isolate}
.fs-bar,.fs-foot,.fs-x,.fs-tip{display:none}
.fs-hub[data-fs]>.fs-bar,.fs-hub[data-fs]>.fs-foot{display:flex}
.fs-bar,.fs-foot{flex:none;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 8px 8px 16px;background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(24px);backdrop-filter:saturate(180%) blur(24px);box-shadow:0 .5px 0 var(--sep)}
.fs-foot{justify-content:flex-end;padding:10px 16px;box-shadow:0 -.5px 0 var(--sep)}
.fs-head{flex:1;min-width:0}
.fs-head>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fs-title{font-size:17px;line-height:22px;font-weight:600}
.fs-sub{font-size:13px;line-height:16px;color:var(--label-2)}
.fs-ctl{order:3;flex:1 0 100%;display:flex;align-items:center;gap:8px;min-width:0;overflow-x:auto;scrollbar-width:none}
@media (min-width:700px){.fs-ctl{order:0;flex:0 1 auto}}
.fs-hub[data-fs][data-look=minimal]>.fs-bar{display:none}
.fs-hub[data-fs][data-look=minimal]>.fs-x{display:flex;position:absolute;z-index:3;top:calc(env(safe-area-inset-top) + 10px);right:calc(env(safe-area-inset-right) + 10px)}
.fs-open{position:absolute;z-index:1001;top:8px;right:8px}
.fs-slot[data-corner=top-left]>.fs-open{right:auto;left:8px}
@media (min-width:1200px){.fs-slot[data-bp=touch]>.fs-open{display:none}}
.fs-hub[data-fs]>.fs-tip{display:block;position:relative;z-index:3;flex:none;height:0}
.fs-hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px 6px 6px 14px;border-radius:9999px;background:var(--label);color:var(--bg);font-size:13px;font-weight:600;white-space:nowrap;box-shadow:var(--shadow-float)}
.fs-hint button{display:grid;place-items:center;width:28px;height:28px;border-radius:50%}
@media (orientation:landscape),(min-width:768px){.fs-hub[data-fs]>.fs-tip{display:none}}
.fs-hub[data-dark][data-fs]{color-scheme:dark;--bg:#000;--card:#1c1c1e;--card-2:#2c2c2e;--fill:rgb(118 118 128/.3);--fill-2:rgb(118 118 128/.18);--field:rgb(118 118 128/.2);--label:#f5f5f7;--label-2:#a1a1a6;--label-3:#6e6e73;--sep:rgb(255 255 255/.1);--hairline:rgb(255 255 255/.08);--bar:rgb(28 28 30/.72);--danger-text:#ff7c75;--shadow-card:0 0 0 1px var(--hairline);--shadow-raised:0 0 0 1px var(--hairline),0 8px 24px rgb(0 0 0/.5);--shadow-float:0 16px 48px rgb(0 0 0/.6),0 2px 10px rgb(0 0 0/.4);--tint-a:16%}
.fs-hub[data-dark][data-fs] .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)}
html[data-fullscreen] .tabbar,html[data-fullscreen] [data-chrome]:not(.fs-hub[data-fs] *){visibility:hidden}
html[data-fullscreen] .shell-stage{transform:none!important;clip-path:none!important;will-change:auto!important}`;

const PARAM = "fs";
const urlWith = (key: string | null) => {
  const u = new URL(location.href);
  if (key) u.searchParams.set(PARAM, key);
  else u.searchParams.delete(PARAM);
  return u.pathname + u.search + u.hash;
};
const inUrl = (key: string) =>
  new URLSearchParams(location.search).get(PARAM) === key;
/** A URL without `?fs=`, normalized the same way on every side of a compare. */
const strip = (href: string) => {
  const u = new URL(href, location.href);
  u.searchParams.delete(PARAM);
  return u.pathname + u.search + u.hash;
};

/**
 * Overlays that stay usable and on top while a hub is full screen: popovers
 * marked `data-fs-top` (the toast host). They join the top layer after the hub
 * and leave it again on close; the app-wide inert skips them.
 */
const TOP = "[data-fs-top]";
const raiseTop = () => {
  for (const t of document.querySelectorAll<HTMLElement>(TOP))
    try {
      if (t.matches(":popover-open")) t.hidePopover();
      t.showPopover();
    } catch {}
};
const lowerTop = () => {
  for (const t of document.querySelectorAll<HTMLElement>(TOP))
    try {
      t.hidePopover();
    } catch {}
};

/** Mounted hubs by `historyKey`, for `openFullscreen`. */
const openers = new Map<string, () => void>();

/**
 * Keys whose `?fs=` entry this document pushed. Closing pops only those (or one
 * the Navigation API shows sits right on the page's own entry); a `?fs=` that came
 * with the page (a reload, a lazily mounted hub, a pasted link) is replaced away,
 * so closing never leaves the page.
 */
const ours = new Set<string>();
type Nav = {
  currentEntry?: { index: number } | null;
  entries?: () => { url: string | null; sameDocument: boolean }[];
};
const prevIs = (base: string | null) => {
  const nav = (globalThis as { navigation?: Nav }).navigation;
  const i = nav?.currentEntry?.index ?? -1;
  const prev = i > 0 ? nav?.entries?.()[i - 1] : undefined;
  return !!base && !!prev?.url && prev.sameDocument && strip(prev.url) === base;
};
/** A URL change that is a history traversal (the router renders it in popstate). */
const traversing = () =>
  (globalThis as { event?: Event }).event?.type === "popstate";
/**
 * Another hub than `el` is still full screen (nested hubs: a signature pad inside
 * present mode). The page-wide state (`html[data-fullscreen]`, the raised toast
 * host, browser full screen) stays until the last one closes.
 */
const othersOpen = (el: Element | null) =>
  Array.from(document.querySelectorAll(".fs-hub[data-fs]")).some(
    (h) => h !== el,
  );
/** Open hubs, innermost last: only the top one answers Esc or the end of browser full screen. */
const stack: object[] = [];
const unstack = (s: object) => {
  const i = stack.indexOf(s);
  if (i >= 0) stack.splice(i, 1);
};

/**
 * Opens the mounted hub with this `historyKey` from anywhere on the page, e.g. a
 * header button (`FullscreenButton`). Call it from a tap: browser full screen
 * needs the user's gesture.
 */
export function openFullscreen(key: string): void {
  openers.get(key)?.();
}

/** Transform that lays the full-screen box `to` over the box `from` (FLIP). */
const flip = (from: DOMRect, to: DOMRect) =>
  `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})`;

function play(el: HTMLElement, a: string, b: string): Animation | null {
  if (!el.animate) return null;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frames = still
    ? [{ opacity: a === "none" ? 1 : 0 }, { opacity: b === "none" ? 1 : 0 }]
    : [
        { transform: a, transformOrigin: "0 0" },
        { transform: b, transformOrigin: "0 0" },
      ];
  const easing =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--ease-spring")
      .trim() || "cubic-bezier(.2,.8,.2,1)";
  const opts = { duration: still ? 150 : 320, fill: "forwards" as const };
  try {
    return el.animate(frames, { ...opts, easing: still ? "linear" : easing });
  } catch {
    return el.animate(frames, { ...opts, easing: "ease-out" });
  }
}

export function FullscreenHub(props: FullscreenHubProps) {
  const {
    children,
    title,
    label,
    subtitle,
    controls,
    footer,
    chrome = "bar",
    breakpoint = "touch",
    trigger = "corner",
    corner = "top-right",
    open,
    defaultOpen,
    theme,
    className,
    bodyClassName,
    expandLabel = "Full screen",
    closeLabel = "Exit full screen",
  } = props;
  const uid = useId();
  const key = props.historyKey ?? `h${uid.replace(/[^a-z0-9]/gi, "")}`;
  const [inner, setInner] = useState(!!defaultOpen);
  const want = open ?? inner;
  const [shown, setShown] = useState(false);
  const [hint, setHint] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const live = useRef(props);
  live.current = props;
  const st = useRef({
    on: false,
    popped: false,
    restore: false,
    browser: false,
    /** The page's URL under the full-screen entry (no `?fs=`), while one is ours. */
    base: null as string | null,
    /** The URL while open with `?fs=` kept, current through shallow updates (picks). */
    last: "",
    /** The app replaced our entry without `?fs=` (a new day): nothing to carry. */
    dropped: false,
    opener: null as HTMLElement | null,
    anim: null as Animation | null,
    undo: [] as (() => void)[],
    finish: null as (() => void) | null,
  });
  // Re-renders on every URL change (pushState / replaceState included), so a
  // selection made inside full screen is known when its history entry pops. The
  // router renders a traversal inside popstate, before our listener: a URL without
  // `?fs=` then is the pop itself, not the app dropping it.
  const search = useSearchParams();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the URL whenever it changes
  useEffect(() => {
    const s = st.current;
    if (!s.on) return;
    if (inUrl(key)) s.last = location.href;
    else if (!traversing()) s.dropped = true;
  }, [search]);

  const setOpen = (v: boolean) => {
    if (live.current.open === undefined) setInner(v);
    live.current.onOpenChange?.(v);
  };
  /** Close from the UI (button, Esc, browser full screen ended) or history. */
  const requestClose = (fromHistory = false) => {
    st.current.popped = fromHistory;
    setOpen(false);
  };

  const enter = () => {
    const el = hub.current;
    const box = slot.current;
    const s = st.current;
    if (!el || !box || s.on) return;
    s.finish?.();
    const from = el.getBoundingClientRect();
    s.on = true;
    stack.push(s);
    s.opener = document.activeElement as HTMLElement | null;
    box.style.minHeight = `${box.offsetHeight}px`;
    try {
      el.showPopover?.();
    } catch {}
    el.setAttribute("data-fs", "");
    raiseTop();
    const html = document.documentElement;
    html.setAttribute("data-fullscreen", "");
    s.base = strip(location.href);
    s.dropped = false;
    if (!inUrl(key)) {
      history.pushState(null, "", urlWith(key));
      ours.add(key);
    }
    s.last = location.href;
    s.popped = false;
    // The rest of the app: inert (sheets, which are dialogs, and the toast host
    // stay usable).
    for (let n: Element = el; n.parentElement && n !== document.body; ) {
      const p: Element = n.parentElement;
      for (const sib of Array.from(p.children))
        if (
          sib !== n &&
          !sib.hasAttribute("inert") &&
          !/^(DIALOG|SCRIPT|STYLE|LINK)$/.test(sib.tagName) &&
          !sib.matches(TOP) &&
          !sib.querySelector("dialog")
        ) {
          sib.setAttribute("inert", "");
          s.undo.push(() => sib.removeAttribute("inert"));
        }
      n = p;
    }
    const lock = live.current.lockScroll ?? true;
    if (lock) s.undo.push(lockPageScroll());
    if (lock === "strict") {
      const prev = html.style.overscrollBehavior;
      html.style.overscrollBehavior = "none";
      s.undo.push(() => {
        html.style.overscrollBehavior = prev;
      });
    }
    const wantBrowser =
      live.current.browserFullscreen ??
      matchMedia("(any-pointer: coarse)").matches;
    if (wantBrowser && !s.restore && document.fullscreenEnabled)
      html
        .requestFullscreen?.({ navigationUI: "hide" })
        .then(() => {
          s.browser = true;
          // Closed before the browser got there: leave it again.
          if (!s.on && !othersOpen(null))
            document.exitFullscreen().catch(() => {});
        })
        .catch(() => {});
    s.restore = false;
    if (live.current.orientationHint) {
      let seen = false;
      try {
        seen = !!localStorage.getItem(`fs-hint:${key}`);
      } catch {}
      setHint(!seen);
    }
    setShown(true);
    closer.current?.focus({ preventScroll: true });
    live.current.onResize?.();
    s.anim = play(el, flip(from, el.getBoundingClientRect()), "none");
    const done = () => {
      s.anim?.cancel();
      s.anim = null;
      live.current.onEnter?.();
    };
    if (s.anim) s.anim.finished.then(done, () => {});
    else done();
  };

  const exit = () => {
    const el = hub.current;
    const box = slot.current;
    const s = st.current;
    if (!el || !box || !s.on) return;
    s.on = false;
    unstack(s);
    if (!s.popped && inUrl(key)) {
      // Our entry pops; the popstate that follows carries the selection over.
      if (ours.has(key) || prevIs(s.base)) history.back();
      else {
        // A ?fs= that came with the page: drop it in place (keeps the rest).
        history.replaceState(null, "", strip(location.href));
        s.base = null;
      }
    } else if (!s.popped) s.base = null;
    s.popped = false;
    // Browser full screen: only ours to leave, and only as the last hub open.
    if (s.browser && document.fullscreenElement && !othersOpen(el))
      document.exitFullscreen().catch(() => {});
    s.browser = false;
    s.anim?.cancel();
    const finish = () => {
      s.finish = null;
      el.removeAttribute("data-fs");
      try {
        el.hidePopover?.();
      } catch {}
      if (!othersOpen(el)) {
        lowerTop();
        document.documentElement.removeAttribute("data-fullscreen");
      }
      box.style.minHeight = "";
      for (const u of s.undo.splice(0)) u();
      s.anim?.cancel();
      s.anim = null;
      setShown(false);
      setHint(false);
      (s.opener?.isConnected
        ? s.opener
        : box.querySelector<HTMLElement>(".fs-open")
      )?.focus({ preventScroll: true });
      live.current.onExit?.();
      live.current.onResize?.();
    };
    s.finish = finish;
    s.anim = play(
      el,
      "none",
      flip(box.getBoundingClientRect(), el.getBoundingClientRect()),
    );
    if (s.anim)
      s.anim.finished.then(
        () => s.finish === finish && finish(),
        () => {},
      );
    else finish();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on the wanted state only
  useLayoutEffect(() => {
    if (want) enter();
    else exit();
  }, [want]);

  // History, for the whole life of the hub (capture: before the page's own
  // listeners and the router's, so they all see the carried-over URL):
  // - our entry comes back (forward, a reload, back from a page opened in full
  //   screen): open again;
  // - our entry pops (back, or `exit()`'s own `history.back()`): close, and keep
  //   what changed inside full screen. A selection made there (`?job=`, `?tech=`,
  //   written with replaceState and `?fs=` kept) rode on the popped entry, so it is
  //   written over the entry we're back on (shallow, no fetch). Not when the app
  //   dropped `?fs=` on purpose (a new day) or the traversal went further back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per key
  useEffect(() => {
    const s = st.current;
    const sync = () => {
      if (inUrl(key)) {
        if (!s.on) {
          s.restore = true;
          setOpen(true);
        }
        return;
      }
      const base = s.base;
      s.base = null;
      if (
        base !== null &&
        !s.dropped &&
        s.last &&
        strip(location.href) === base
      ) {
        const next = strip(s.last);
        if (next !== base) history.replaceState(null, "", next);
      }
      if (s.on) requestClose(true);
    };
    // A controlled hub that is closed at mount with its key in the URL (a reload
    // while it was open, a lazily mounted signature pad or photo viewer): its
    // owner opens it, not the URL, so the stale `?fs=` goes.
    if (inUrl(key) && live.current.open === false)
      history.replaceState(null, "", strip(location.href));
    else sync();
    addEventListener("popstate", sync, true);
    const opener = () => setOpen(true);
    openers.set(key, opener);
    return () => {
      removeEventListener("popstate", sync, true);
      if (openers.get(key) === opener) openers.delete(key);
      // Unmounted while open (navigated away): leave the page as it was.
      if (!s.on) return;
      s.on = false;
      unstack(s);
      s.base = null;
      for (const u of s.undo.splice(0)) u();
      if (othersOpen(hub.current)) return;
      lowerTop();
      document.documentElement.removeAttribute("data-fullscreen");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners read refs
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        stack[stack.length - 1] === st.current &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        requestClose();
      }
    };
    const onFs = () => {
      const s = st.current;
      const el = hub.current;
      if (document.fullscreenElement) {
        // The page's root joins the top layer above us when it goes full
        // screen: step back on top (no remount; focus stays on Close), then the
        // overlays that stay above us.
        s.browser = true;
        if (el?.matches(":popover-open")) {
          try {
            el.hidePopover();
            el.showPopover();
          } catch {}
          raiseTop();
          closer.current?.focus({ preventScroll: true });
        }
      } else if (s.browser) {
        // The browser left full screen (Esc there): the top hub closes, the
        // ones under it stay open in the page.
        s.browser = false;
        if (stack[stack.length - 1] === s) requestClose();
      }
    };
    const body = hub.current?.querySelector(".fs-body");
    const ro = new ResizeObserver(() => live.current.onResize?.());
    if (body) ro.observe(body);
    addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      ro.disconnect();
      removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [shown]);

  const closeBtn = (
    <IconButton
      ref={closer}
      label={closeLabel}
      variant={chrome === "minimal" ? "material" : "secondary"}
      size={36}
      onClick={() => requestClose()}
    >
      {chrome === "minimal" ? (
        <X size={18} aria-hidden />
      ) : (
        <Minimize2 size={18} aria-hidden />
      )}
    </IconButton>
  );

  return (
    <div
      ref={slot}
      className={cx("fs-slot", className)}
      data-bp={breakpoint}
      data-corner={corner}
    >
      <style href="fs-hub" precedence="default">
        {CSS}
      </style>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is "dialog" exactly while aria-modal is set */}
      <div
        ref={hub}
        className="fs-hub"
        popover="manual"
        data-look={chrome}
        data-dark={theme === "dark" ? "" : undefined}
        role={shown ? "dialog" : undefined}
        aria-modal={shown || undefined}
        aria-label={
          shown
            ? (label ?? (typeof title === "string" ? title : undefined))
            : undefined
        }
      >
        <div className="fs-bar">
          <div className="fs-head">
            <span className="fs-title">{title}</span>
            {subtitle && <span className="fs-sub">{subtitle}</span>}
          </div>
          {controls && <div className="fs-ctl">{controls}</div>}
          {chrome === "bar" && closeBtn}
        </div>
        <div className={cx("fs-body", bodyClassName)}>{children}</div>
        {/* A zero-height row above the footer: the tip never covers its buttons. */}
        {hint && (
          <div className="fs-tip">
            <div className="fs-hint">
              Rotate for a wider view
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => {
                  try {
                    localStorage.setItem(`fs-hint:${key}`, "1");
                  } catch {}
                  setHint(false);
                }}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          </div>
        )}
        {footer && <div className="fs-foot">{footer}</div>}
        {chrome === "minimal" && <div className="fs-x">{closeBtn}</div>}
      </div>
      {trigger === "corner" ? (
        <IconButton
          label={expandLabel}
          variant="material"
          size={36}
          className="fs-open"
          onClick={() => setOpen(true)}
        >
          <Maximize2 size={18} aria-hidden />
        </IconButton>
      ) : typeof trigger === "function" ? (
        trigger(() => setOpen(true))
      ) : null}
    </div>
  );
}
