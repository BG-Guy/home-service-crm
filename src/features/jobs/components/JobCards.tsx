"use client";

import dynamic from "next/dynamic";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import type { JobListFilters, JobListItem } from "../types";
import { JobBox } from "./JobBox";
import { fetchJobsPage } from "./list-reads";

const JobPeekSheet = dynamic(() => import("./JobPeekSheet"), { ssr: false });

export interface JobCardGroup {
  key: string;
  label: string;
  items: JobListItem[];
}

/**
 * The /jobs card layout (the default): each day's jobs as a grid of cards (one
 * column on phones, two on tablets, as many as fit on desktop). Open or a tap on
 * a card peeks at the job in a sheet, mirrored in `?job=<id>` so Back closes it;
 * the peek's button opens the full job page. "Load more" appends cards.
 */
export function JobCards({
  groups,
  tz,
  filters,
  cursor,
  headerTop,
}: {
  groups: JobCardGroup[];
  tz: string;
  filters: JobListFilters;
  cursor: string | null;
  /** Sticky offset of the day headers (under the page's filter bar). */
  headerTop: string;
}) {
  const [more, setMore] = useState<JobListItem[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [pending, start] = useTransition();
  const [peekId, setPeekId] = useState<string | null>(null);
  // The sheet's chunk loads on the first peek, then stays for its close animation.
  const [used, setUsed] = useState(false);
  useEffect(() => {
    if (peekId) setUsed(true);
  }, [peekId]);

  const all = useMemo(() => {
    const m = new Map<string, JobListItem>();
    for (const g of groups) for (const j of g.items) m.set(j.id, j);
    for (const j of more) m.set(j.id, j);
    return m;
  }, [groups, more]);

  // ?job=<id>: open on load and on Back / Forward.
  useEffect(() => {
    const read = () => {
      const id = new URL(window.location.href).searchParams.get("job");
      if (!id) pushed.current = false;
      setPeekId(id);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  // Like the lead card: one pushed entry while a peek is open (null state, so the
  // app router keeps the URL), so Back closes it; closing steps back over it.
  const pushed = useRef(false);
  const peek = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("job", id);
    if (pushed.current) window.history.replaceState(null, "", url);
    else {
      window.history.pushState(null, "", url);
      pushed.current = true;
    }
    setPeekId(id);
  }, []);
  const close = useCallback(() => {
    setPeekId(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("job")) {
      url.searchParams.delete("job");
      window.history.replaceState(null, "", url);
    }
  }, []);

  const load = () =>
    start(async () => {
      const r = await fetchJobsPage({ ...filters, cursor: next });
      if (!r.ok || !r.data) {
        toast.error(r.ok ? "Couldn't load more jobs." : r.error);
        return;
      }
      setMore((prev) => [...prev, ...(r.data?.items ?? [])]);
      setNext(r.data.nextCursor);
    });

  const grid =
    "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]";
  return (
    <div className="enter-stagger flex flex-col gap-5">
      {groups.map((g, i) => (
        <section
          key={g.key}
          aria-labelledby={`day-${g.key}`}
          style={{ ["--i" as string]: Math.min(i, 9) } as CSSProperties}
        >
          <h2
            id={`day-${g.key}`}
            className="sticky z-[9] -mx-[var(--gutter)] flex items-baseline justify-between bg-bg px-[calc(var(--gutter)+4px)] pt-2 pb-2 text-title3"
            style={{ top: headerTop }}
          >
            {g.label}
            <span className="num text-subhead font-medium text-label-2">
              {g.items.length} {g.items.length === 1 ? "job" : "jobs"}
            </span>
          </h2>
          <ul aria-label={`${g.label} jobs`} className={grid}>
            {g.items.map((j) => (
              <li key={j.id} className="min-w-0">
                <JobBox
                  job={j}
                  tz={tz}
                  showDate={g.key === "none"}
                  onPeek={peek}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more.length > 0 && (
        <ul aria-label="More jobs" className={grid}>
          {more.map((j) => (
            <li key={j.id} className="min-w-0">
              <JobBox job={j} tz={tz} showDate onPeek={peek} />
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button variant="gray" fullWidth loading={pending} onClick={load}>
          Load more
        </Button>
      )}
      {(used || peekId) && (
        <JobPeekSheet
          job={peekId ? (all.get(peekId) ?? null) : null}
          tz={tz}
          onClose={close}
        />
      )}
    </div>
  );
}
