"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { formatDateKey } from "@/lib/time";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { Skeleton } from "@/ui/components/Skeleton";
import { cx } from "@/ui/cx";
import type { BoardData } from "../../schedule-queries";
import { ParamPeriodStepper, ParamSegmented } from "../ParamControls";

// The calendar board of /schedule (day = tech columns, 3 days / week = day
// columns). In the page from 1024 px only; phones and tablets held upright get the
// server-rendered list and never download the board's chunk until they open it.
// Full screen (FullscreenHub "board", DESIGN.md M19) on touch: the corner Expand
// on the in-page board (1024–1199 px), or the header's board button
// (`FullscreenButton hub="board"`) where the page shows the list. Inside, the
// board fills the screen and scrolls under its sticky tech / day headers; the
// arrows and the Day / 3 days / Week switch replace the entry without ?fs=.

const BoardGrid = dynamic(() => import("./BoardGrid"), {
  ssr: false,
  loading: () => <Skeleton height={480} rounded="card" />,
});

const QUERY = "(min-width: 1024px)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

// The corner Expand sits in the board card's 48 px header row, clear of the
// queues rail (260 px + 16 px gap): at its right end, or over the empty corner
// cell of the time column in the day view. Full screen, 3 days / week: a day
// column is the board's width over the days to show (`--days`: about 7 on a
// landscape tablet, 4 upright, 3.75 on a landscape phone, 2.2 upright), never
// under 124 px; BoardGrid gives days without jobs half of it.
const SLOT_CSS = `.sb-slot .fs-open{top:6px;right:282px}
.sb-day .fs-open{right:auto;left:10px}
.sb-cols{container-type:inline-size}
.sb-grid{--days:2.2;--col:max(124px,calc(100cqw / var(--days)))}
@media (orientation:landscape) and (max-height:520px){.sb-grid{--days:3.75}}
@media (min-width:700px) and (orientation:portrait){.sb-grid{--days:4}}
@media (min-width:1000px) and (min-height:521px){.sb-grid{--days:7}}`;

const VIEWS = [
  { value: "day", label: "Day" },
  { value: "3day", label: "3 days" },
  { value: "week", label: "Week" },
] as const;

/** "Wed, Oct 22", "Oct 22 – 24", "Oct 30 – Nov 1". */
function rangeLabel(days: readonly string[]): string {
  const first = days[0] ?? "";
  const last = days[days.length - 1] ?? first;
  if (days.length <= 1)
    return formatDateKey(first, "en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${formatDateKey(first, "en-US", { month: "short", day: "numeric" })} – ${formatDateKey(
    last,
    "en-US",
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}

export function ScheduleBoard({
  data,
  colorBy,
}: {
  data: BoardData;
  colorBy: "status" | "tech";
}) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  const [fs, setFs] = useState(false);
  const step = data.view === "day" ? 1 : data.view === "3day" ? 3 : 7;
  const jobs = data.jobs.length;
  const queued = data.unscheduled.length;
  const range = rangeLabel(data.days);
  const unit =
    data.view === "day" ? "Day" : data.view === "3day" ? "3 days" : "Week";
  return (
    <FullscreenHub
      className={cx("sb-slot", data.view === "day" && "sb-day")}
      historyKey="board"
      title="Schedule"
      label={`Schedule, ${range}`}
      subtitle={`${jobs} job${jobs === 1 ? "" : "s"}${queued ? ` · ${queued} unscheduled` : ""}`}
      orientationHint="landscape"
      // The list replaces the board below 1024 px: open it from the header there.
      trigger={desktop ? "corner" : "none"}
      expandLabel="Full screen board"
      onOpenChange={setFs}
      controls={
        // Wraps (the switch under the arrows) where one row doesn't fit.
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
          <ParamPeriodStepper
            value={data.date}
            step={step}
            prevLabel={`Previous ${unit.toLowerCase()}`}
            nextLabel={`Next ${unit.toLowerCase()}`}
          >
            {range}
          </ParamPeriodStepper>
          <ParamSegmented
            param="view"
            label="Calendar view"
            value={data.view}
            className="w-52 flex-none"
            segments={VIEWS}
          />
        </div>
      }
    >
      <style href="schedule-board" precedence="default">
        {SLOT_CSS}
      </style>
      {(desktop || fs) && <BoardGrid data={data} colorBy={colorBy} fill={fs} />}
    </FullscreenHub>
  );
}
