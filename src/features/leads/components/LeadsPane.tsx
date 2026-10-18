import { Inbox, Search } from "lucide-react";
import { Suspense } from "react";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { SkeletonCard } from "@/ui/components/Skeleton";
import type { LeadView } from "../contracts";
import {
  type LeadFilter,
  leadCounts,
  listActiveSources,
  listLeads,
} from "../queries";
import { LeadCard } from "./LeadCard";
import { LeadLoadMore } from "./LeadLoadMore";

const VIEWS: { value: LeadView; label: string }[] = [
  { value: "inbox", label: "Inbox" },
  { value: "check", label: "Check" },
  { value: "booked", label: "Booked" },
  { value: "lost", label: "Lost" },
  { value: "spam", label: "Spam" },
];

export function leadFilterFrom(
  sp: Record<string, string | string[] | undefined>,
): LeadFilter {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s?.trim() ? s.trim().slice(0, 100) : undefined;
  };
  const view = one("view") as LeadView | undefined;
  const filter = one("filter");
  return {
    view:
      VIEWS.some((v) => v.value === view) || view === "all" ? view : undefined,
    status: one("status")?.split(",").filter(Boolean),
    source: one("source"),
    from: one("from"),
    to: one("to"),
    filter:
      filter === "check" || filter === "breached" || filter === "mine"
        ? filter
        : undefined,
    q: one("q"),
  };
}

function qs(f: LeadFilter, patch: Partial<LeadFilter>): string {
  const next = { ...f, ...patch };
  const sp = new URLSearchParams();
  if (next.view) sp.set("view", next.view);
  if (next.status?.length) sp.set("status", next.status.join(","));
  if (next.source) sp.set("source", next.source);
  if (next.from) sp.set("from", next.from);
  if (next.to) sp.set("to", next.to);
  if (next.filter) sp.set("filter", next.filter);
  if (next.q) sp.set("q", next.q);
  const s = sp.toString();
  return s ? `/leads?${s}` : "/leads";
}

async function LeadChips({
  f,
  viewer,
}: {
  f: LeadFilter;
  viewer: SessionUser;
}) {
  const [counts, sources] = await Promise.all([
    leadCounts(viewer),
    listActiveSources(),
  ]);
  const view = f.view ?? (f.status?.length || f.filter ? undefined : "inbox");
  return (
    <ChipRow label="Filter leads">
      {VIEWS.map((v) => (
        <Chip
          key={v.value}
          href={qs({ q: f.q, source: f.source }, { view: v.value })}
          selected={view === v.value && !f.filter}
          count={
            v.value === "booked" || v.value === "lost"
              ? undefined
              : counts[v.value]
          }
          replace
        >
          {v.label}
        </Chip>
      ))}
      <Chip
        href={qs(
          { q: f.q },
          { filter: f.filter === "mine" ? undefined : "mine" },
        )}
        selected={f.filter === "mine"}
        count={counts.mine}
        replace
      >
        Mine
      </Chip>
      {counts.breached > 0 && (
        <Chip
          href={qs(
            { q: f.q },
            { filter: f.filter === "breached" ? undefined : "breached" },
          )}
          selected={f.filter === "breached"}
          count={counts.breached}
          replace
        >
          Overdue
        </Chip>
      )}
      {sources.map((s) => (
        <Chip
          key={s.id}
          href={qs(f, { source: f.source === s.id ? undefined : s.id })}
          selected={f.source === s.id}
          replace
        >
          {s.name}
        </Chip>
      ))}
      {/* A turned-off source (linked from its settings page) has no chip of
          its own: show the filter anyway, so it can be cleared. */}
      {f.source && !sources.some((s) => s.id === f.source) && (
        <Chip href={qs(f, { source: undefined })} selected replace>
          Turned-off source
        </Chip>
      )}
    </ChipRow>
  );
}

async function LeadList({
  f,
  viewer,
  activeId,
}: {
  f: LeadFilter;
  viewer: SessionUser;
  activeId?: string;
}) {
  const [{ items, hasMore }, settings] = await Promise.all([
    listLeads(viewer, f),
    getSettings(),
  ]);
  const canEdit = viewer.perms.has("leads.edit");
  if (items.length === 0) {
    const filtered = !!(f.q || f.source || f.filter || f.status?.length);
    return (
      <div className="list-card">
        <EmptyState
          compact
          icon={
            filtered ? (
              <Search size={40} strokeWidth={1.6} />
            ) : (
              <Inbox size={44} strokeWidth={1.5} />
            )
          }
          title={
            filtered
              ? "No matching leads"
              : f.view === "check"
                ? "Nothing to check"
                : f.view === "spam"
                  ? "No spam"
                  : "Inbox zero"
          }
          message={
            filtered
              ? "Try another filter or search."
              : (f.view ?? "inbox") === "inbox"
                ? "New requests from your website, marketplaces and phone show up here with a speed-to-lead timer."
                : undefined
          }
          action={
            !filtered &&
            (f.view ?? "inbox") === "inbox" &&
            viewer.perms.has("settings.api_keys") ? (
              <Button variant="tinted" size="sm" href="/settings/lead-sources">
                Connect your website
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  const reasons = settings.leads.lost_reasons;
  return (
    <div className="flex flex-col gap-3">
      {items.map((l) => (
        <LeadCard
          key={l.id}
          lead={l}
          viewerId={viewer.id}
          canEdit={canEdit}
          lostReasons={reasons}
          active={l.id === activeId}
        />
      ))}
      {hasMore && (
        <LeadLoadMore
          filter={f}
          offset={items.length}
          viewerId={viewer.id}
          canEdit={canEdit}
          lostReasons={reasons}
        />
      )}
    </div>
  );
}

/** The leads inbox column (full page on phones, left pane on desktop). */
export function LeadsPane({
  filter,
  viewer,
  activeId,
}: {
  filter: LeadFilter;
  viewer: SessionUser;
  activeId?: string;
}) {
  return (
    <>
      <LargeTitleHeader
        history={false}
        title="Leads"
        // "New lead" lives in the shell's + menu (first on /leads), so no second + here (T4-11).
        trailing={<HeaderActions />}
        search={
          <SearchField
            param="q"
            defaultValue={filter.q ?? ""}
            placeholder="Name, phone, service"
            label="Search leads"
          />
        }
      >
        <Suspense fallback={<div className="h-8" />}>
          <LeadChips f={filter} viewer={viewer} />
        </Suspense>
      </LargeTitleHeader>
      <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] pb-8">
        <Suspense
          key={JSON.stringify(filter)}
          fallback={
            <div className="flex flex-col gap-3">
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={3} />
            </div>
          }
        >
          <LeadList f={filter} viewer={viewer} activeId={activeId} />
        </Suspense>
      </div>
    </>
  );
}
