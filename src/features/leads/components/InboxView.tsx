"use client";

import { LayoutGrid, Map as MapIcon, Rows3 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { cx } from "@/ui/cx";
import { type InboxShow, type LeadCols, writeLeadCols } from "./inbox-prefs";
import { InboxViewContext, type InboxViewState } from "./inbox-state";
import { LeadsMapSlot } from "./LeadsMapSlot";
import { useMediaQuery } from "./lead-links";
import type { LeadsMapData } from "./map/types";

/**
 * The inbox body (leads-flow items 1 and 10): the count line with the phone
 * 1 / 2 column switch (kept in a cookie, so the server renders the same grid),
 * the status chips, then the grid; the map sits beside it on desktop and behind
 * the Grid / Map switch on phones and tablets. In Map mode the map fills the
 * screen under the header and the count line, the chips and the boxes ride in
 * its drawer, with the switch on the drawer's edge.
 */
export function InboxView({
  initialCols,
  initialShow,
  count,
  noun,
  sort,
  chips,
  map,
  children,
}: {
  initialCols: LeadCols;
  initialShow: InboxShow;
  count: number;
  /** "open leads", "new leads"… */
  noun: string;
  /** "Longest wait first". */
  sort: string;
  chips: ReactNode;
  /** The lead map's pins and today's jobs (`getLeadsMapData`, from the page). */
  map?: Promise<LeadsMapData | null>;
  children: ReactNode;
}) {
  const [cols, setColsState] = useState<LeadCols>(initialCols);
  const [show, setShowState] = useState<InboxShow>(initialShow);
  const [selected, setSelected] = useState<string | null>(null);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const mapOn = desktop || show === "map";
  const state = useMemo<InboxViewState>(
    () => ({
      mapOn,
      selected,
      setSelected,
      cols,
      setCols: (c) => {
        setColsState(c);
        writeLeadCols(c);
      },
      show,
      setShow: (s) => {
        setShowState(s);
        const url = new URL(window.location.href);
        if (s === "map") url.searchParams.set("show", "map");
        else url.searchParams.delete("show");
        window.history.replaceState(null, "", url);
      },
    }),
    [cols, show, mapOn, selected],
  );

  const countLine = (
    <div className="flex min-h-11 items-center gap-3">
      <h2 className="min-w-0 truncate text-title3">
        <span className="num">{count}</span> {noun}
      </h2>
      <span className="ml-auto truncate text-footnote text-label-2">
        {sort}
      </span>
      <SegmentedControl
        className="w-[92px] shrink-0 md:hidden"
        label="Columns"
        value={String(cols) as "1" | "2"}
        onChange={(v) => state.setCols(v === "1" ? 1 : 2)}
        segments={[
          {
            value: "1",
            label: (
              <span className="flex justify-center" title="1 column">
                <Rows3 size={17} aria-hidden />
                <span className="sr-only">1 column</span>
              </span>
            ),
          },
          {
            value: "2",
            label: (
              <span className="flex justify-center" title="2 columns">
                <LayoutGrid size={17} aria-hidden />
                <span className="sr-only">2 columns</span>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
  // Phones and tablets in Map mode: the full-height map, the inbox in its drawer.
  const phoneMap = !desktop && show === "map";

  return (
    <InboxViewContext.Provider value={state}>
      {phoneMap ? (
        <LeadsMapSlot
          layout="phone"
          map={map}
          count={count}
          header={
            <>
              {countLine}
              <div className="mt-1">{chips}</div>
            </>
          }
          onShowGrid={() => state.setShow("grid")}
        >
          {children}
        </LeadsMapSlot>
      ) : (
        <>
          {countLine}
          <div className="mt-1">{chips}</div>
          {/* Desktop: one column of leads on the left, the map (about half the
              viewport, never squeezing the list under 340 px) as the main view. */}
          <div className="mt-3 lg:grid lg:grid-cols-[minmax(340px,1fr)_min(50vw,calc(100%_-_360px))] lg:items-start lg:gap-5">
            <div className="min-w-0">{children}</div>
            <div className="max-lg:hidden lg:sticky lg:top-[calc(env(safe-area-inset-top)+60px)]">
              {desktop && (
                <LeadsMapSlot layout="panel" map={map} count={count} />
              )}
            </div>
          </div>
          <GridMapSwitch show={show} onChange={state.setShow} />
        </>
      )}
    </InboxViewContext.Provider>
  );
}

/** The phone / tablet Grid · Map pill, floating above the tab bar. */
function GridMapSwitch({
  show,
  onChange,
}: {
  show: InboxShow;
  onChange: (s: InboxShow) => void;
}) {
  const item = (value: InboxShow, icon: ReactNode, label: string) => (
    <button
      type="button"
      aria-pressed={show === value}
      onClick={() => onChange(value)}
      className={cx(
        "pressable flex h-10 items-center gap-2 rounded-pill px-4 text-subhead font-semibold",
        show === value ? "bg-white text-[#111113]" : "text-white",
      )}
    >
      {icon}
      {label}
    </button>
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a two-button toggle group
    <div
      role="group"
      aria-label="Show leads as"
      className="sticky bottom-[max(12px,var(--tabbar-space))] z-[var(--z-sticky)] mx-auto mt-4 flex w-fit gap-1 rounded-pill bg-[#111113] p-1 shadow-[var(--shadow-float)] lg:hidden dark:bg-[#2c2c2e]"
    >
      {item("grid", <LayoutGrid size={17} aria-hidden />, "Grid")}
      {item("map", <MapIcon size={17} aria-hidden />, "Map")}
    </div>
  );
}
