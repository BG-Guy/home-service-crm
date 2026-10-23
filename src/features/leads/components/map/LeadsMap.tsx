"use client";

import { ChevronDown, ChevronUp, MapPinOff, Maximize2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { IconButton } from "@/ui/components/IconButton";
import { cx } from "@/ui/cx";
import { LeadBox } from "../LeadBox";
import { useLeadCardMaybe } from "../lead-env";
import { useNow } from "../lead-links";
import {
  cycleDetent,
  DETENT_LABEL,
  type Detent,
  detentTops,
  dragTop,
  releaseVelocity,
  snapDrawer,
  stepDetent,
} from "./drawer";
import { GridMapSwitch } from "./GridMapSwitch";
import { LEADS_MAP_CSS } from "./map-css";
import { coverageNote } from "./pins";
import type { LeadsMapProps, MapCoverage } from "./types";

// The lead map (leads-flow redesign item 10, contract 3.4). Default export, so
// the inbox loads it lazily (LazyLeadsMap); Leaflet is a second lazy chunk
// (LeadsMapCanvas, client only). Two layouts:
// - phone: the map fills the screen under the header with the lead boxes in a
//   draggable drawer (peek, half, full; ./drawer.ts). Dragging it all the way
//   down, or the corner button, opens full screen: the drawer slides away and
//   "Show N leads" brings it back. The Grid / Map switch rides on the drawer.
// - panel: the desktop column beside the grid (sticky, a card), no drawer.
// Full screen is the kit FullscreenHub (?fs=leads-map, Back exits). Tapping a pin
// opens the lead card (useLeadCard().open) and keeps that pin selected.

const Canvas = dynamic(() => import("./LeadsMapCanvas"), {
  ssr: false,
  loading: () => <div aria-hidden className="lm-canvas shimmer" />,
});

/** Room kept for the notes and the corner button over the top of the map. */
const COVER_TOP = 56;
/** Room kept for "Show N leads" at the bottom of the full-screen map. */
const COVER_PILL = 88;
/** Room the Grid / Map switch takes above the drawer. */
const SWITCH_ROOM = 64;
/** A click right after a drag is the drag's end, not a tap. */
const CLICK_GRACE_MS = 350;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

export default function LeadsMap(props: LeadsMapProps) {
  const {
    points,
    jobs,
    layout,
    tileUrl,
    attribution = "",
    setupHref = null,
    coverage,
    boxes,
    cols = 2,
    drawerHeader,
    drawerFooter,
    onShowGrid,
    className,
    children,
  } = props;
  const phone = layout === "phone";
  const card = useLeadCardMaybe();
  const cardRef = useRef(card);
  cardRef.current = card;
  const now = useNow();
  const [fs, setFs] = useState(false);

  // Selection: the parent's, else the open card, else the last pin tapped (it
  // stays highlighted once the card closes).
  const [picked, setPicked] = useState<string | null>(null);
  const openId = card?.openId ?? null;
  useEffect(() => {
    if (openId) setPicked(openId);
  }, [openId]);
  const selected =
    props.selectedId !== undefined ? props.selectedId : (openId ?? picked);
  const count = props.count ?? boxes?.length ?? points.length;

  // The drawer's boxes open the card with their TL;DR at once.
  useEffect(() => {
    if (boxes?.length) cardRef.current?.seed(boxes);
  }, [boxes]);

  const pick = (id: string) => {
    setPicked(id);
    // Contract 3.4: a pin opens the card (once, also when onSelect is card.open).
    if (props.onSelect !== card?.open) card?.open(id);
    props.onSelect?.(id);
  };

  // ---- phone: region size, the tab bar's inset, the drawer
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [inset, setInset] = useState(0);
  /** Panel: how much of it starts below the screen's bottom (a long sticky column). */
  const [fold, setFold] = useState(0);
  const [detent, setDetent] = useState<Detent>("half");
  const tops = useMemo(() => detentTops(h, inset), [h, inset]);
  const target = fs ? tops.away : tops[detent];
  const drag = useRef<null | {
    id: number;
    x0: number;
    y0: number;
    top0: number;
    on: boolean;
    samples: { t: number; y: number }[];
  }>(null);
  const dragEnd = useRef(0);

  // The region fills the screen from its top edge down (under the tab bar):
  // --lm-top is that edge in the document (layout offsets, so the sheet's card
  // stack scale doesn't skew it), and --lm-below hands back the page's own
  // padding under the region, so the page itself doesn't scroll.
  useLayoutEffect(() => {
    if (!phone) return;
    const el = root.current;
    if (!el) return;
    const measure = () => {
      if (document.documentElement.hasAttribute("data-fullscreen")) return;
      let y = 0;
      for (
        let n: HTMLElement | null = el;
        n;
        n = n.offsetParent as HTMLElement | null
      )
        y += n.offsetTop;
      el.style.setProperty("--lm-top", `${Math.max(0, y)}px`);
      const given = -(
        Number.parseFloat(getComputedStyle(el).marginBottom) || 0
      );
      const below =
        document.documentElement.scrollHeight - (y + el.offsetHeight) + given;
      el.style.setProperty("--lm-below", `${Math.max(0, Math.round(below))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      removeEventListener("resize", measure);
    };
  }, [phone]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const height = Math.round(e?.contentRect.height ?? 0);
      if (height) setH(height);
      // Measured on a resize only (never on scroll): the first view frames the
      // pins in the part of the panel that is on screen.
      if (!document.documentElement.hasAttribute("data-fullscreen"))
        setFold(
          Math.max(
            0,
            Math.round(el.getBoundingClientRect().bottom - window.innerHeight),
          ),
        );
      setInset(
        document.documentElement.hasAttribute("data-fullscreen")
          ? 0
          : (probe.current?.offsetHeight ?? 0),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The drawer moves on transform; a drag writes it directly, React only on settle.
  useLayoutEffect(() => {
    const d = drawer.current;
    if (!d || !h || drag.current?.on) return;
    d.style.transform = `translate3d(0,${target}px,0)`;
  }, [target, h]);

  const currentTop = () => {
    const d = drawer.current;
    if (!d) return target;
    const t = getComputedStyle(d).transform;
    return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : target;
  };

  const settle = (to: Detent | "away") => {
    const d = drawer.current;
    if (to === "away") {
      setFs(true);
      return;
    }
    setDetent(to);
    if (d) d.style.transform = `translate3d(0,${tops[to]}px,0)`;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (fs || !h) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".lm-switch")) return;
    // At full height the boxes scroll; only the top (handle, header) drags.
    if (detent === "full" && !t.closest(".lm-dtop")) return;
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      top0: currentTop(),
      on: false,
      samples: [{ t: e.timeStamp, y: e.clientY }],
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = drag.current;
    const d = drawer.current;
    if (!g || !d || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.on) {
      // Sideways first: a swipe on a box or the chips, not a drag.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dy) < 6) return;
      g.on = true;
      g.top0 = currentTop();
      g.y0 = e.clientY;
      d.setAttribute("data-drag", "");
      try {
        d.setPointerCapture(e.pointerId);
      } catch {}
    }
    d.style.transform = `translate3d(0,${dragTop(g.top0 + (e.clientY - g.y0), tops)}px,0)`;
    g.samples.push({ t: e.timeStamp, y: e.clientY });
    if (g.samples.length > 8) g.samples.shift();
  };
  const onPointerEnd = (e: ReactPointerEvent<HTMLElement>, cancel = false) => {
    const g = drag.current;
    if (!g || e.pointerId !== g.id) return;
    drag.current = null;
    if (!g.on) return;
    drawer.current?.removeAttribute("data-drag");
    dragEnd.current = Date.now();
    settle(
      snapDrawer(currentTop(), cancel ? 0 : releaseVelocity(g.samples), tops),
    );
  };

  const onFsChange = (open: boolean) => {
    setFs(open);
    // Back from full screen: the drawer comes back at half height.
    if (!open) setDetent("half");
  };

  // A pin picked on the map: bring its box into the drawer's view.
  useEffect(() => {
    const b = body.current;
    if (!phone || !b || !selected) return;
    const box = b.querySelector<HTMLElement>(
      `[data-lead="${CSS.escape(selected)}"]`,
    );
    if (!box) return;
    const top = box.offsetTop;
    if (
      top < b.scrollTop ||
      top + box.offsetHeight > b.scrollTop + b.clientHeight
    )
      b.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
  }, [selected, phone]);

  const coverBottom = fs
    ? COVER_PILL
    : phone
      ? h
        ? // The drawer, and the Grid / Map switch riding on its edge.
          Math.max(0, h - target) + (onShowGrid ? SWITCH_ROOM : 0)
        : 0
      : fold;
  const mapLabel = `Map of ${plural(points.length, "open lead", "open leads")} and ${plural(jobs.length, "job", "jobs")} today`;

  const canvas = (
    <div className="lm-mapwrap" inert={phone && detent === "full" && !fs}>
      <Canvas
        points={points}
        jobs={jobs}
        selected={selected}
        now={now}
        coverTop={COVER_TOP}
        coverBottom={coverBottom}
        liftControls={phone || fs}
        zoomControl={!phone}
        tileUrl={tileUrl}
        attribution={attribution}
        label={mapLabel}
        onPick={pick}
        onClear={() => setPicked(null)}
        onHover={(id) => {
          if (id) cardRef.current?.prefetch(id);
        }}
      />
    </div>
  );
  const chrome = (
    <>
      <MapNotes coverage={coverage} tileUrl={tileUrl} setupHref={setupHref} />
      <IconButton
        label="Full screen map"
        variant="material"
        size={36}
        className="lm-expand"
        onClick={() => setFs(true)}
      >
        <Maximize2 size={18} aria-hidden />
      </IconButton>
      {points.length === 0 && jobs.length === 0 && (
        <p className="lm-empty">
          <span className="rounded-full bg-card px-3 py-1 text-footnote text-label-2 shadow-card">
            No open leads on the map yet
          </span>
        </p>
      )}
    </>
  );
  const showLeads = (
    <button
      type="button"
      className="lm-show pressable text-subhead font-semibold"
      onClick={() => setFs(false)}
    >
      <ChevronUp size={18} aria-hidden />
      Show {plural(count, "lead", "leads")}
    </button>
  );

  return (
    <div
      ref={root}
      className={cx("lm", phone ? "lm-phone" : "lm-panel", className)}
    >
      <style href="leads-map" precedence="default">
        {LEADS_MAP_CSS}
      </style>
      {phone && <div ref={probe} aria-hidden className="lm-probe" />}
      <FullscreenHub
        title="Leads map"
        label="Leads map"
        historyKey="leads-map"
        chrome="minimal"
        trigger="none"
        breakpoint="all"
        open={fs}
        onOpenChange={onFsChange}
        className="lm-slot"
        closeLabel="Exit full screen"
      >
        <div ref={stage} className="lm-stage">
          {canvas}
          <div className="contents" inert={phone && detent === "full" && !fs}>
            {chrome}
          </div>
          {phone && (
            <section
              ref={drawer}
              aria-label="Leads"
              className="lm-drawer"
              data-detent={detent}
              inert={fs}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => onPointerEnd(e)}
              onPointerCancel={(e) => onPointerEnd(e, true)}
              onClickCapture={(e) => {
                if (Date.now() - dragEnd.current < CLICK_GRACE_MS) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {onShowGrid && (
                <div className="lm-switch">
                  <GridMapSwitch
                    value="map"
                    onChange={(v) => {
                      if (v === "grid") onShowGrid();
                    }}
                  />
                </div>
              )}
              <div className="lm-dtop">
                <button
                  type="button"
                  className="lm-grab"
                  aria-label={DETENT_LABEL[detent]}
                  onClick={() => setDetent(cycleDetent(detent))}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    settle(stepDetent(detent, e.key === "ArrowUp" ? 1 : -1));
                  }}
                />
                <div className="lm-dhead">
                  {drawerHeader ?? (
                    <h2 className="text-headline">
                      {plural(count, "open lead", "open leads")}
                    </h2>
                  )}
                </div>
              </div>
              <div ref={body} className="lm-dbody relative">
                {children ? (
                  children
                ) : boxes && boxes.length > 0 ? (
                  <div className="lm-grid" data-cols={cols}>
                    {boxes.map((b) => (
                      <div key={b.id} data-lead={b.id} className="min-w-0">
                        <LeadBox
                          lead={b}
                          layout={cols === 1 ? "grid1" : "drawer"}
                          selected={b.id === selected}
                          onOpen={pick}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-6 text-center text-subhead text-label-2">
                    No leads in this view
                  </p>
                )}
                {drawerFooter}
              </div>
            </section>
          )}
          {showLeads}
        </div>
      </FullscreenHub>
    </div>
  );
}

/** "4 of 6 leads on the map" (tap for why), and "Street map is off". */
function MapNotes({
  coverage,
  tileUrl,
  setupHref,
}: {
  coverage: MapCoverage | undefined;
  tileUrl: string;
  setupHref: string | null;
}) {
  const note = coverageNote(coverage);
  const [open, setOpen] = useState(false);
  if (!note && tileUrl) return null;
  return (
    <div className="lm-notes">
      {note && (
        <div className="lm-note material text-footnote">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="pressable font-semibold text-label"
          >
            <MapPinOff
              size={15}
              aria-hidden
              className="shrink-0 text-label-2"
            />
            <span className="truncate">{note.title}</span>
            <ChevronDown
              size={15}
              aria-hidden
              className={cx(
                "shrink-0 text-label-2 transition-transform duration-[var(--dur-quick)]",
                open && "rotate-180",
              )}
            />
          </button>
          {open && (
            <ul className="text-label-2">
              {note.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!tileUrl && (
        <p className="lm-note material px-3 py-2 text-footnote text-label-2">
          Street map is off.
          {setupHref && (
            <>
              {" "}
              <Link href={setupHref} className="text-accent-text">
                Set it up
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
