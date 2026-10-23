"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  addTransitionType,
  createContext,
  type MouseEvent,
  type ReactNode,
  startTransition,
  use,
  useEffect,
  useRef,
  useState,
  ViewTransition,
} from "react";
import type { RouteMapProps } from "@/features/map/components/RouteMap";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import {
  BACK_LINK,
  BAR_LEADING,
  BAR_ROW,
  BAR_TITLE,
  BAR_TRAILING,
  BackChevron,
} from "@/ui/components/bar-parts";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { IconButton } from "@/ui/components/IconButton";
import { PeriodStepper } from "@/ui/components/PeriodStepper";
import { cx } from "@/ui/cx";
import { Morph } from "@/ui/motion/Morph";
import { type TechChipItem, TechChips } from "../../components/TechChips";
import { type HubQuery, hubHref } from "../href";

// Assign hub shell (/dispatch, client). The server renders the list and one
// panel per tech; this component only owns the selection. Picking a tech is a
// client state change mirrored into the URL with history.pushState (`?tech=`),
// so it is instant, back works, and nothing re-renders on the server. Phone: the
// list and the tech view are two screens (M1 push, M3 avatar morph). Tablet:
// list | map over panel. Desktop: list | map | panel (container queries on the
// hub width, since the sidebar takes 256 px). Leaflet loads lazily, only once
// the map is on screen. Below 1200 px the map opens full screen (FullscreenHub
// "routes"): the day and the tech chips in its top bar, and on `?job=` the one
// "Assign <name>" in its footer; there a pick replaces the history entry, so back
// leaves full screen in one step and keeps the pick.

const RouteMap = dynamic(() => import("@/features/map/components/RouteMap"), {
  ssr: false,
  loading: () => <div aria-hidden className="shimmer size-full" />,
});

const PHONE = "(max-width: 767.98px)";

// Route-local layout CSS (keeps the global stylesheet at its budget). Columns follow
// the hub's own width: 1 → list | map over panel (640) → list | map | panel (1040).
const HUB_CSS = `.hub{container-type:inline-size}
.hub-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.hub-col{display:flex;min-width:0;flex-direction:column;gap:var(--section-gap)}
.hub-map{position:relative;margin:-8px calc(-1*var(--gutter)) 0;height:40dvh;min-height:240px;overflow:hidden;background:var(--card-2)}
.hub-row[data-on]{background:color-mix(in srgb,var(--accent) var(--tint-a),transparent)}
@container (min-width:640px){.hub-grid{grid-template-columns:minmax(0,300px) minmax(0,1fr);align-items:start}.hub-list{grid-row:span 2}.hub-map{grid-column:2;grid-row:1;margin:0;height:380px;border-radius:var(--radius-card);box-shadow:var(--shadow-card)}.hub-panel{grid-column:2}}
@container (min-width:1040px){.hub-grid{grid-template-columns:300px minmax(0,1fr) minmax(0,360px);gap:20px}.hub-list{grid-row:auto}.hub-map{position:sticky;top:calc(env(safe-area-inset-top) + 60px);height:calc(100dvh - env(safe-area-inset-top) - 148px);min-height:440px}.hub-panel{grid-column:3;grid-row:1}}
.hub-date:has(:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:767.98px){.hub-head[data-sel],.hub[data-sel] .hub-list,.hub:not([data-sel]):not([data-fs]) .hub-map,.hub:not([data-sel]) .hub-panel,.hub-wide{display:none}}`;

interface Ctx {
  /** Phone layout (list and tech view are two screens). */
  phone: boolean;
  selected: string | null;
  /** The tech whose panel is showing (selected, or the default on wide screens). */
  current: string | null;
  select: (id: string | null) => void;
  query: HubQuery;
}
const HubCtx = createContext<Ctx | null>(null);

const PUSH_IN = { "nav-forward": "push-in", default: "none" } as const;
const PUSH_OUT = { "nav-forward": "push-out", default: "none" } as const;
const POP_IN = { "nav-back": "pop-in", default: "none" } as const;
const POP_OUT = { "nav-back": "pop-out", default: "none" } as const;
const FADE_IN = { "hub-select": "tab-in", default: "none" } as const;
const FADE_OUT = { "hub-select": "tab-out", default: "none" } as const;

export function DispatchHub({
  header,
  list,
  panels,
  emptyPanel,
  defaultTech,
  initialSelected,
  query,
  todayKey,
  names,
  phoneTrailing,
  map,
  chips,
  footers,
  fsSubtitle,
}: {
  /** LargeTitleHeader (hidden on the phone tech view). */
  header: ReactNode;
  list: ReactNode;
  panels: Record<string, ReactNode>;
  emptyPanel: ReactNode;
  /** Panel shown on tablet/desktop before anything is picked. */
  defaultTech: string | null;
  initialSelected: string | null;
  query: HubQuery;
  todayKey: string;
  names: Record<string, string>;
  /** Phone tech view nav-bar trailing (call button) per tech. */
  phoneTrailing: Record<string, ReactNode>;
  map: Omit<RouteMapProps, "selected" | "onSelect" | "proposal"> & {
    proposals: Record<string, RouteMapProps["proposal"]>;
  };
  /** Full-screen top bar: one chip per tech. */
  chips: readonly TechChipItem[];
  /** Full-screen footer per tech on `?job=`: the job and "Assign <name>". */
  footers: Record<string, ReactNode>;
  /** Full-screen top bar subtitle ("Who should take J-1042?"). */
  fsSubtitle: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [phone, setPhone] = useState(false);
  const [mapOn, setMapOn] = useState(false);
  const [fs, setFs] = useState(false);
  const pushed = useRef(0);
  // The top history entry is the full screen's (pushed on open, rewritten by picks
  // inside it): its pop is not one of our pushed picks.
  const fsSlot = useRef(false);
  const valid = (id: string | null) => (id && id in panels ? id : null);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  // Leaflet only once the map is visible (never on the phone list).
  useEffect(() => {
    if (!phone || selected || fs) setMapOn(true);
  }, [phone, selected, fs]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: panels are stable per render
  useEffect(() => {
    const onPop = () => {
      if (fsSlot.current) fsSlot.current = false;
      else pushed.current = Math.max(0, pushed.current - 1);
      setSelected(valid(new URLSearchParams(location.search).get("tech")));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // A server refresh (date change, assign) may bring a new initial selection.
  useEffect(() => setSelected(initialSelected), [initialSelected]);

  const select = (id: string | null) => {
    if (fs) {
      // Full screen: replace the entry and keep ?fs=, so back closes it at once
      // (FullscreenHub carries the pick over to the page underneath).
      startTransition(() => {
        addTransitionType("hub-select");
        setSelected(id);
      });
      const url = new URL(hubHref(query, id), location.origin);
      const key = new URLSearchParams(location.search).get("fs");
      if (key) url.searchParams.set("fs", key);
      history.replaceState(null, "", url.pathname + url.search);
      return;
    }
    const isPhone = window.matchMedia(PHONE).matches;
    if (id === null && pushed.current > 0) {
      startTransition(() => {
        addTransitionType("nav-back");
        setSelected(null);
      });
      pushed.current -= 1;
      history.back();
      return;
    }
    startTransition(() => {
      addTransitionType(
        isPhone ? (id ? "nav-forward" : "nav-back") : "hub-select",
      );
      setSelected(id);
    });
    const url = hubHref(query, id);
    if (id) {
      history.pushState(null, "", url);
      pushed.current += 1;
    } else history.replaceState(null, "", url);
  };

  const effective = selected ?? (phone ? null : defaultTech);
  const panel = (effective && panels[effective]) || emptyPanel;
  const showList = !(phone && selected);
  const proposal = effective ? (map.proposals[effective] ?? null) : null;
  // Full screen: another day replaces the entry without ?fs= (DESIGN.md M19).
  const day = (d: string) =>
    router.replace(hubHref(query, selected, d), { scroll: false });
  const rel =
    query.date === todayKey
      ? "Today"
      : query.date === addDaysToKey(todayKey, 1)
        ? "Tomorrow"
        : query.date === addDaysToKey(todayKey, -1)
          ? "Yesterday"
          : null;
  const dayText = rel
    ? `${rel} · ${formatDateKey(query.date, "en-US", { month: "short", day: "numeric" })}`
    : formatDateKey(query.date, "en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

  return (
    <HubCtx value={{ phone, selected, current: effective, select, query }}>
      <div className="hub-head contents" data-sel={selected ? "" : undefined}>
        {header}
      </div>
      {selected && (
        <header
          data-chrome
          className="nav-bar pt-[env(safe-area-inset-top)] md:hidden"
        >
          <div className={BAR_ROW}>
            <div className={BAR_LEADING}>
              <a
                href={hubHref(query)}
                onClick={(e) => {
                  e.preventDefault();
                  select(null);
                }}
                className={BACK_LINK}
              >
                <BackChevron />
                <span className="truncate">Assign</span>
              </a>
            </div>
            <div className={BAR_TITLE}>
              <h1 className="truncate text-headline">{names[selected]}</h1>
            </div>
            <div className={BAR_TRAILING}>{phoneTrailing[selected]}</div>
          </div>
        </header>
      )}
      <style href="dispatch-hub" precedence="default">
        {HUB_CSS}
      </style>
      <Page wide className="pt-2">
        <div
          className="hub"
          data-sel={selected ? "" : undefined}
          data-fs={fs ? "" : undefined}
        >
          <div className="hub-grid">
            {showList && (
              <ViewTransition enter={POP_IN} exit={PUSH_OUT} default="none">
                <div className="hub-col hub-list">{list}</div>
              </ViewTransition>
            )}
            {/* Keyed list ↔ tech view only (never per tech), so picking another
                tech never remounts the map or an open full screen. */}
            <ViewTransition
              key={phone ? (selected ? "tech" : "list") : "wide"}
              enter={PUSH_IN}
              exit={POP_OUT}
              default="none"
            >
              <div className="hub-map">
                <FullscreenHub
                  historyKey="routes"
                  title="Routes"
                  subtitle={fsSubtitle}
                  className="size-full"
                  expandLabel="Full screen map"
                  onOpenChange={(o) => {
                    setFs(o);
                    if (o) fsSlot.current = true;
                  }}
                  controls={
                    <>
                      <PeriodStepper
                        prevLabel="Previous day"
                        nextLabel="Next day"
                        onPrev={() => day(addDaysToKey(query.date, -1))}
                        onNext={() => day(addDaysToKey(query.date, 1))}
                      >
                        {dayText}
                      </PeriodStepper>
                      <TechChips
                        bare
                        items={chips}
                        value={effective}
                        onChange={(id) => id && select(id)}
                        label="Show a technician's route"
                      />
                    </>
                  }
                  footer={
                    query.job && effective ? footers[effective] : undefined
                  }
                >
                  {mapOn ? (
                    <RouteMap
                      {...map}
                      selected={effective}
                      proposal={proposal}
                      onSelect={(id) => select(id)}
                      className="size-full"
                    />
                  ) : (
                    <div aria-hidden className="shimmer size-full" />
                  )}
                </FullscreenHub>
              </div>
              <div className="hub-col hub-panel">
                <ViewTransition
                  key={effective ?? "none"}
                  enter={FADE_IN}
                  exit={FADE_OUT}
                  default="none"
                >
                  <div className="hub-col">{panel}</div>
                </ViewTransition>
              </div>
            </ViewTransition>
          </div>
        </div>
      </Page>
    </HubCtx>
  );
}

/**
 * The tech avatar's M3 morph in the panel, on phones only: wide screens show the
 * list and the panel at once, and a morph name may be mounted only once.
 */
export function PhoneMorph({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return use(HubCtx)?.phone ? <Morph name={name}>{children}</Morph> : children;
}

/** A tech list row that selects the tech in place (a real link without JS). */
export function SelectTech({
  id,
  children,
  className,
  label,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const ctx = use(HubCtx);
  const on = ctx?.current === id;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!ctx || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    ctx.select(id);
  };
  return (
    <a
      href={ctx ? hubHref(ctx.query, id) : `?tech=${id}`}
      onClick={onClick}
      aria-current={on ? "true" : undefined}
      aria-label={label}
      data-on={on || undefined}
      className={cx(
        "hub-row row-press flex w-full items-center gap-3 text-left outline-offset-[-2px]",
        className,
      )}
    >
      {children}
    </a>
  );
}

/** Day switcher: previous / next day and a date field. Keeps job and tech. */
export function HubDateBar({
  date,
  todayKey,
}: {
  date: string;
  todayKey: string;
}) {
  const ctx = use(HubCtx);
  const router = useRouter();
  const q = ctx?.query ?? { date, job: null };
  const tech = ctx?.selected ?? null;
  const go = (d: string) => router.push(hubHref(q, tech, d), { scroll: false });
  const label =
    date === todayKey
      ? "Today"
      : date === addDaysToKey(todayKey, 1)
        ? "Tomorrow"
        : date === addDaysToKey(todayKey, -1)
          ? "Yesterday"
          : formatDateKey(date, "en-US", { weekday: "long" });
  return (
    <div className="card flex items-center gap-1 p-1.5">
      <IconButton
        label="Previous day"
        variant="plain"
        size={40}
        href={hubHref(q, tech, addDaysToKey(date, -1))}
      >
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      <label className="hub-date relative flex min-w-0 flex-1 flex-col items-center rounded-control px-2 py-1 text-center">
        <span className="text-headline">{label}</span>
        <span className="num text-footnote text-label-2">
          {formatDateKey(date, "en-US", {
            month: "short",
            day: "numeric",
            year:
              date.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric",
          })}
        </span>
        <input
          type="date"
          aria-label="Pick a day"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <IconButton
        label="Next day"
        variant="plain"
        size={40}
        href={hubHref(q, tech, addDaysToKey(date, 1))}
      >
        <ChevronRight size={20} aria-hidden />
      </IconButton>
    </div>
  );
}
