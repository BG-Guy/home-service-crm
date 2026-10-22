"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { humanize } from "../status";
import { FullscreenHub } from "./FullscreenHub";
import { IconButton } from "./IconButton";
import { containSize, type Photo, photoAlt } from "./photos";

/**
 * Full-screen photo viewer (DESIGN.md "Fullscreen hub (M19)", use 5): a
 * `FullscreenHub` (no trigger, minimal chrome, dark) around a horizontal CSS
 * scroll-snap carousel, so swiping is the browser's own (momentum included).
 * It grows from the tapped thumbnail and shrinks back into the thumbnail of
 * the photo on screen. Counter "3 / 12", a caption (tag, time, who took it),
 * prev/next buttons and ←/→ on tablets and desktop; Esc, the close button and
 * back close it. Only the photo on screen and its neighbours load; double-tap
 * zooms 2× and the zoomed photo pans with native scrolling.
 *
 * Load it lazily (`PhotoGrid` does): nothing ships until a photo is tapped.
 *
 * ```tsx
 * const [index, setIndex] = useState<number | null>(null);
 * <PhotoViewer photos={photos} index={index} onIndexChange={setIndex}
 *   anchor={(i) => grid.current?.querySelector(`[data-pi="${i}"]`)} />
 * ```
 */
export interface PhotoViewerProps {
  photos: readonly Photo[];
  /** The photo on screen, or null (closed). */
  index: number | null;
  /** Swipes, arrows and keys report the new index; closing reports null. */
  onIndexChange: (index: number | null) => void;
  /** The element to grow from and shrink back into (the photo's thumbnail). */
  anchor?: (index: number) => Element | null | undefined;
  tagLabel?: (tag: string) => string;
  /** Buttons for the photo on screen, at the end of the caption bar (e.g. Info). */
  actions?: (photo: Photo, index: number) => ReactNode;
  /** `?fs=` value while open (default "photo"). */
  historyKey?: string;
}

const CSS = `.pv-anchor{position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none}
.pv-anchor>.fs-slot{width:100%;height:100%}
.pv-anchor .fs-hub[data-fs]{visibility:visible;pointer-events:auto}
.pv{position:absolute;inset:0;overflow:hidden;color:#fff;-webkit-user-select:none;user-select:none}
.pv-track{position:absolute;inset:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior:contain;scrollbar-width:none}
.pv-track::-webkit-scrollbar{display:none}
.pv-track[data-zoom]{overflow-x:hidden}
.pv-slide{position:relative;flex:none;width:100%;height:100%;margin:0;overflow:hidden;scroll-snap-align:center;scroll-snap-stop:always;touch-action:manipulation}
.pv .pv-slide img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:contain;-webkit-user-drag:none}
.pv .pv-full{opacity:0;transition:opacity .2s ease-out}
.pv .pv-full[data-ready]{opacity:1}
.pv .pv-slide[data-zoom]{overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y}
.pv .pv-slide[data-zoom] .pv-thumb{display:none}
.pv .pv-slide[data-zoom] .pv-full{position:static;display:block;object-fit:fill;opacity:1}
.pv-top{position:absolute;inset:0 0 auto;display:flex;justify-content:center;padding:14px 64px 32px;background:linear-gradient(rgb(0 0 0/.45),transparent);pointer-events:none}
.pv-count{padding:3px 12px;border-radius:9999px;background:rgb(0 0 0/.35);font-size:15px;line-height:22px;font-weight:600;font-variant-numeric:tabular-nums}
.pv .pv-nav{position:absolute;top:calc(50% - 22px);display:none}
.pv .pv-prev{left:12px}
.pv .pv-next{right:12px}
.pv .pv-nav:disabled{visibility:hidden}
@media (min-width:768px){.pv .pv-nav{display:inline-flex}}
.pv-cap{position:absolute;inset:auto 0 0;display:flex;align-items:flex-end;gap:12px;padding:44px 16px 16px;background:linear-gradient(transparent,rgb(0 0 0/.72))}
.pv-cap:empty{display:none}
.pv-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;font-size:13px;line-height:18px}
.pv-line{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;color:rgb(255 255 255/.8)}
.pv-tag{padding:1px 8px;border-radius:9999px;background:rgb(255 255 255/.2);color:#fff;font-weight:600}
.pv-text{font-size:15px;line-height:20px;color:#fff;overflow-wrap:anywhere}
.pv-act{display:flex;gap:8px;flex:none}`;

const STYLE_KEY = "photo-viewer";

type Zoom = {
  i: number;
  w: number;
  h: number;
  mx: number;
  my: number;
  u: number;
  v: number;
};

const clampIndex = (i: number, n: number) =>
  Math.max(0, Math.min(Math.max(0, n - 1), Math.round(i)));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Photos that should have their images: the one on screen and its neighbours. */
const around = (i: number, n: number, keep?: ReadonlySet<number>) => {
  const s = new Set(keep);
  for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < n) s.add(j);
  return s;
};
const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Puts `el` (position: fixed) exactly over `target`, so the hub grows from it.
 * A transformed or contained ancestor shifts fixed boxes: measure and correct.
 * No target, or one off screen: a centered box (the viewer zooms in from it).
 */
function placeOver(el: HTMLElement, target: Element | null | undefined) {
  const vw = innerWidth;
  const vh = innerHeight;
  let r = target?.getBoundingClientRect();
  if (
    !r ||
    r.width < 1 ||
    r.height < 1 ||
    r.bottom <= 0 ||
    r.right <= 0 ||
    r.top >= vh ||
    r.left >= vw
  )
    r = new DOMRect(vw * 0.15, vh * 0.25, vw * 0.7, vh * 0.5);
  const s = el.style;
  s.left = `${r.left}px`;
  s.top = `${r.top}px`;
  s.width = `${r.width}px`;
  s.height = `${r.height}px`;
  const got = el.getBoundingClientRect();
  if (Math.abs(got.left - r.left) > 0.5) s.left = `${2 * r.left - got.left}px`;
  if (Math.abs(got.top - r.top) > 0.5) s.top = `${2 * r.top - got.top}px`;
}

export function PhotoViewer({
  photos,
  index,
  onIndexChange,
  anchor,
  tagLabel = humanize,
  actions,
  historyKey = "photo",
}: PhotoViewerProps) {
  const n = photos.length;
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [cur, setCur] = useState(() => clampIndex(index ?? 0, n));
  const [near, setNear] = useState<ReadonlySet<number>>(() => around(cur, n));
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const curRef = useRef(cur);
  const shownId = useRef(photos[cur]?.id);
  const openRef = useRef(false);
  openRef.current = open;
  const live = useRef({ onIndexChange, anchor, photos });
  live.current = { onIndexChange, anchor, photos };
  const raf = useRef(0);
  const tap = useRef<{ t: number; x: number; y: number } | null>(null);

  /** Scrolls the carousel to photo `i` (instantly, or smoothly for arrows). */
  const jump = (i: number, smooth = false) => {
    const t = track.current;
    if (!t) return;
    const left = i * t.clientWidth;
    if (smooth)
      t.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    else t.scrollLeft = left;
  };

  /** Records `i` as the photo on screen (from a swipe, an arrow or a key). */
  const settle = (i: number) => {
    if (i === curRef.current) return;
    curRef.current = i;
    shownId.current = live.current.photos[i]?.id;
    setCur(i);
    setNear((s) => around(i, live.current.photos.length, s));
    setZoom(null);
    live.current.onIndexChange(i);
  };

  const go = (i: number) => {
    const j = clampIndex(i, n);
    setZoom(null);
    jump(j, true);
  };

  /** Moves the hub's in-page box over photo `i`'s thumbnail (scrolled into view). */
  const place = (i: number, scroll: boolean) => {
    const el = wrap.current;
    if (!el) return;
    const target = live.current.anchor?.(i) ?? null;
    if (scroll && target) {
      const r = target.getBoundingClientRect();
      if (
        r.top < 0 ||
        r.bottom > innerHeight ||
        r.left < 0 ||
        r.right > innerWidth
      )
        target.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "instant",
        });
    }
    placeOver(el, target);
  };

  // The photo list changed (re-tagged, removed, refreshed): stay on the same
  // photo, or its neighbour when it is gone. Keyed on the ids, not the array.
  const ids = photos.map((p) => p.id).join("|");
  const lastIds = useRef(ids);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids; the rest is read from refs
  useLayoutEffect(() => {
    if (ids === lastIds.current) return;
    lastIds.current = ids;
    const list = live.current.photos;
    if (list.length === 0) {
      if (openRef.current) live.current.onIndexChange(null);
      return;
    }
    const j = list.findIndex((p) => p.id === shownId.current);
    const i = j >= 0 ? j : clampIndex(curRef.current, list.length);
    shownId.current = list[i]?.id;
    setNear(around(i, list.length));
    if (i === curRef.current) return;
    curRef.current = i;
    setCur(i);
    setZoom(null);
    jump(i);
    if (openRef.current) live.current.onIndexChange(i);
  }, [ids]);

  // Open, close or move as `index` says.
  // biome-ignore lint/correctness/useExhaustiveDependencies: driven by `index`; the rest is read from refs
  useLayoutEffect(() => {
    if (index == null) {
      if (!openRef.current) return;
      setZoom(null);
      place(curRef.current, true);
      setOpen(false);
      return;
    }
    const i = clampIndex(index, n);
    if (!openRef.current) {
      curRef.current = i;
      shownId.current = live.current.photos[i]?.id;
      setCur(i);
      setNear(around(i, n));
      setZoom(null);
      setNested(!!document.querySelector(".fs-hub[data-fs]"));
      place(i, false);
      jump(i);
      setOpen(true);
      return;
    }
    if (i !== curRef.current) go(i);
  }, [index]);

  // Arrow keys while open (not while a sheet or field has them). Esc too when
  // this viewer sits inside another full-screen hub (a photo in the estimate
  // presentation): the outer hub sees Esc first and keeps it for itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads refs
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const hubs = document.querySelectorAll(".fs-hub[data-fs]");
        const mine = wrap.current?.querySelector(".fs-hub");
        if (
          hubs.length > 1 &&
          hubs[hubs.length - 1] === mine &&
          !document.querySelector("dialog[open]")
        )
          live.current.onIndexChange(null);
        return;
      }
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (document.querySelector("dialog[open]")) return;
      if ((e.target as Element | null)?.closest?.("input,textarea,select"))
        return;
      e.preventDefault();
      go(curRef.current + (e.key === "ArrowRight" ? 1 : -1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  // Keep the zoomed point under the finger.
  useLayoutEffect(() => {
    if (!zoom) return;
    const slide = track.current?.children[zoom.i] as HTMLElement | undefined;
    if (!slide) return;
    slide.scrollLeft = zoom.mx + zoom.u * zoom.w - slide.clientWidth / 2;
    slide.scrollTop = zoom.my + zoom.v * zoom.h - slide.clientHeight / 2;
  }, [zoom]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onScroll = () => {
    if (!openRef.current) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const t = track.current;
      if (!t || !t.clientWidth) return;
      settle(
        clampIndex(t.scrollLeft / t.clientWidth, live.current.photos.length),
      );
    });
  };

  /** Double-tap (or double-click) toggles a 2× zoom around the tapped point. */
  const onSlideClick = (e: ReactMouseEvent<HTMLElement>, i: number) => {
    const last = tap.current;
    if (
      !last ||
      e.timeStamp - last.t > 350 ||
      Math.hypot(e.clientX - last.x, e.clientY - last.y) > 32
    ) {
      tap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      return;
    }
    tap.current = null;
    if (zoom) {
      setZoom(null);
      return;
    }
    const slide = e.currentTarget;
    const img =
      slide.querySelector<HTMLImageElement>(".pv-full[data-ready]") ??
      slide.querySelector<HTMLImageElement>(".pv-thumb");
    if (!img?.naturalWidth) return;
    const W = slide.clientWidth;
    const H = slide.clientHeight;
    const r = slide.getBoundingClientRect();
    const fit = containSize(
      { w: img.naturalWidth, h: img.naturalHeight },
      { w: W, h: H },
    );
    const w = fit.w * 2;
    const h = fit.h * 2;
    setZoom({
      i,
      w,
      h,
      mx: Math.max(0, (W - w) / 2),
      my: Math.max(0, (H - h) / 2),
      u: clamp01((e.clientX - r.left - (W - fit.w) / 2) / fit.w),
      v: clamp01((e.clientY - r.top - (H - fit.h) / 2) / fit.h),
    });
  };

  const markReady = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth) img.dataset.ready = "";
  };

  const p = photos[cur];
  const meta = p ? [p.takenAt, p.by].filter(Boolean).join(" · ") : "";

  return (
    <div ref={wrap} className="pv-anchor">
      <style href={STYLE_KEY} precedence="default">
        {CSS}
      </style>
      <FullscreenHub
        open={open}
        onOpenChange={(o) =>
          live.current.onIndexChange(o ? curRef.current : null)
        }
        trigger="none"
        chrome="minimal"
        theme="dark"
        historyKey={historyKey}
        browserFullscreen={nested ? false : undefined}
        title={`Photo ${cur + 1} of ${n}`}
        label="Photo viewer"
        closeLabel="Close photo"
        onResize={() => {
          setZoom(null);
          jump(curRef.current);
        }}
        // Focus lands on the thumbnail of the photo that was on screen.
        onExit={() => {
          const t = live.current.anchor?.(curRef.current);
          if (t instanceof HTMLElement) t.focus({ preventScroll: true });
        }}
      >
        <div className="pv">
          <div
            ref={track}
            className="pv-track"
            data-zoom={zoom ? "" : undefined}
            onScroll={onScroll}
          >
            {photos.map((ph, j) => {
              const z = zoom?.i === j ? zoom : null;
              return (
                // Double-tap zoom is a pointer shortcut; arrows and buttons navigate.
                <figure
                  key={ph.id}
                  className="pv-slide"
                  aria-label={`${j + 1} of ${n}`}
                  aria-hidden={j !== cur || undefined}
                  data-zoom={z ? "" : undefined}
                  onClick={(e) => onSlideClick(e, j)}
                >
                  {near.has(j) ? (
                    <>
                      {/* biome-ignore lint/performance/noImgElement: signed thumbnail, shown until the full photo loads */}
                      <img
                        className="pv-thumb"
                        src={ph.thumbUrl}
                        alt=""
                        aria-hidden
                        decoding="async"
                        draggable={false}
                      />
                      {/* biome-ignore lint/performance/noImgElement: signed full-size URL */}
                      <img
                        ref={markReady}
                        className="pv-full"
                        src={ph.url}
                        alt={photoAlt(ph, tagLabel)}
                        decoding="async"
                        fetchPriority={j === cur ? "high" : "low"}
                        draggable={false}
                        onLoad={(e) => {
                          e.currentTarget.dataset.ready = "";
                        }}
                        style={
                          z
                            ? {
                                width: z.w,
                                height: z.h,
                                margin: `${z.my}px ${z.mx}px`,
                              }
                            : undefined
                        }
                      />
                    </>
                  ) : null}
                </figure>
              );
            })}
          </div>
          <div className="pv-top">
            <span className="pv-count" aria-hidden>
              {cur + 1} / {n}
            </span>
          </div>
          <p className="sr-only" aria-live="polite">
            Photo {cur + 1} of {n}
          </p>
          {n > 1 ? (
            <>
              <IconButton
                label="Previous photo"
                variant="material"
                size={44}
                className="pv-nav pv-prev"
                disabled={cur === 0}
                onClick={() => go(cur - 1)}
              >
                <ChevronLeft size={24} aria-hidden />
              </IconButton>
              <IconButton
                label="Next photo"
                variant="material"
                size={44}
                className="pv-nav pv-next"
                disabled={cur >= n - 1}
                onClick={() => go(cur + 1)}
              >
                <ChevronRight size={24} aria-hidden />
              </IconButton>
            </>
          ) : null}
          {p && (p.tag || meta || p.caption || actions) ? (
            <div className="pv-cap">
              <div className="pv-meta">
                {p.tag || meta ? (
                  <span className="pv-line">
                    {p.tag ? (
                      <span className="pv-tag">{tagLabel(p.tag)}</span>
                    ) : null}
                    {meta ? <span className="num">{meta}</span> : null}
                  </span>
                ) : null}
                {p.caption ? <p className="pv-text">{p.caption}</p> : null}
              </div>
              {actions ? <div className="pv-act">{actions(p, cur)}</div> : null}
            </div>
          ) : null}
        </div>
      </FullscreenHub>
    </div>
  );
}

export default PhotoViewer;
