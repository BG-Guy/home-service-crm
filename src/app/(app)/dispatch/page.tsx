import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { DispatchHub } from "@/features/jobs/dispatch/components/DispatchHub";
import {
  HubFsFooter,
  HubList,
  PhoneTrailing,
  TechPanel,
} from "@/features/jobs/dispatch/components/HubViews";
import { loadDispatchHub } from "@/features/jobs/dispatch/queries";
import type { Recommendation } from "@/features/jobs/dispatch/recommend";
import type { HubPoint, HubTech } from "@/features/jobs/dispatch/types";
import type { RouteMapProps } from "@/features/map/components/RouteMap";
import { requireUser } from "@/lib/auth/current";
import { formatDateKey } from "@/lib/time";
import { initials } from "@/ui/components/Avatar";
import { Card } from "@/ui/components/Card";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Assign" };

const one = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : undefined;

/** Point the recommended detour leaves from / returns to on a tech's route. */
function detour(t: HubTech, r: Recommendation) {
  const at = (id: string | null): HubPoint | null => {
    if (!id) return null;
    const s = t.jobs.find((x) => x.id === id);
    return s && s.lat != null && s.lng != null
      ? { lat: s.lat, lng: s.lng }
      : null;
  };
  return {
    techId: t.id,
    from: r.insertAfter === "start" ? t.start : at(r.insertAfter),
    to: at(r.insertBefore),
  };
}

// Assign hub (SPEC M05 dispatch; owner request Oct 2026): technicians for a day,
// their routes on a map, a tech's profile and day, and who to send for `?job=`.
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser("jobs.assign");
  const sp = await searchParams;
  const data = await loadDispatchHub({ date: one(sp.date), job: one(sp.job) });
  const tech = one(sp.tech);
  const selected = data.techs.some((t) => t.id === tech)
    ? (tech ?? null)
    : null;
  const recByTech = new Map(data.recs.map((r) => [r.techId, r]));
  const defaultTech =
    data.recs[0]?.techId ??
    data.techs.find((t) => t.jobs.length > 0)?.id ??
    data.techs[0]?.id ??
    null;

  const panels: Record<string, React.ReactNode> = {};
  const names: Record<string, string> = {};
  const phoneTrailing: Record<string, React.ReactNode> = {};
  const proposals: Record<string, RouteMapProps["proposal"]> = {};
  // Full screen (the map's FullscreenHub): the job and "Assign <name>" per tech.
  const footers: Record<string, React.ReactNode> = {};
  for (const t of data.techs) {
    const r = recByTech.get(t.id);
    panels[t.id] = <TechPanel t={t} data={data} rec={r} />;
    names[t.id] = t.name;
    phoneTrailing[t.id] = <PhoneTrailing t={t} />;
    if (data.job) footers[t.id] = <HubFsFooter t={t} data={data} rec={r} />;
    if (r && data.job?.lat != null && !data.job.assigneeIds.includes(t.id))
      proposals[t.id] = detour(t, r);
  }
  const chips = data.techs.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    count: t.jobs.length,
  }));
  const routes = data.techs.map((t) => ({
    techId: t.id,
    name: t.name,
    color: t.color,
    initials: initials(t.name),
    start: t.start,
    stops: t.jobs
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        id: s.id,
        seq: s.seq,
        lat: s.lat as number,
        lng: s.lng as number,
        label: `${s.number} ${s.title}`,
        done: s.status === "completed" || s.status === "closed",
      })),
  }));
  const job =
    data.job && data.job.lat != null && data.job.lng != null
      ? { lat: data.job.lat, lng: data.job.lng, label: data.job.number }
      : null;
  const unassigned = data.toAssign.length;
  const needs = unassigned
    ? `${unassigned} need${unassigned === 1 ? "s" : ""} a tech`
    : "all assigned";
  const subtitle = data.job
    ? `Who should take ${data.job.number}?`
    : `${formatDateKey(data.date, "en-US", { weekday: "long", month: "short", day: "numeric" })} · ${needs}`;

  return (
    <PageTransition>
      <DispatchHub
        header={
          <LargeTitleHeader
            title="Assign"
            subtitle={subtitle}
            trailing={<HeaderActions />}
          />
        }
        list={<HubList data={data} recByTech={recByTech} />}
        panels={panels}
        emptyPanel={
          <Card>
            <EmptyState
              compact
              title="Pick a technician"
              message="Their day, route and details show here."
            />
          </Card>
        }
        defaultTech={defaultTech}
        initialSelected={selected}
        query={{ date: data.date, job: data.job?.id ?? null }}
        todayKey={data.todayKey}
        names={names}
        phoneTrailing={phoneTrailing}
        chips={chips}
        footers={footers}
        fsSubtitle={
          data.job
            ? `Who should take ${data.job.number}?`
            : unassigned
              ? `${unassigned} job${unassigned === 1 ? " needs" : "s need"} a tech`
              : "Every job has a tech"
        }
        map={{
          routes,
          job,
          proposals,
          tileUrl: data.tileUrl,
          attribution: data.attribution,
          canSetup: data.canSetup,
        }}
      />
    </PageTransition>
  );
}
