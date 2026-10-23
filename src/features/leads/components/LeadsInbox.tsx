import { Inbox, Plus, Search } from "lucide-react";
import { Suspense } from "react";
import { getMapConfig } from "@/adapters/maps";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { Skeleton } from "@/ui/components/Skeleton";
import type { LeadView } from "../contracts";
import {
  countLeads,
  type LeadCounts,
  type LeadFilter,
  leadCounts,
  listActiveSources,
  listLeads,
} from "../queries";
import { InboxView } from "./InboxView";
import type { InboxShow, LeadCols } from "./inbox-prefs";
import { LeadFilterButton } from "./LeadFilterButton";
import { LeadCardProvider } from "./LeadProviders";
import { LeadsGrid } from "./LeadsGrid";
import type { LeadEnvInit } from "./lead-env";
import type { LeadsMapData } from "./map/types";
import { SelectedChipInView } from "./SelectedChipInView";

const VIEWS: readonly LeadView[] = [
  "inbox",
  "new",
  "contacted",
  "qualified",
  "check",
  "booked",
  "lost",
  "spam",
  "all",
];

/** URL → filter (?view=, ?q=, ?source=, ?mine=1, ?overdue=1; older ?filter= links). */
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
    view: view && VIEWS.includes(view) ? view : undefined,
    status: one("status")?.split(",").filter(Boolean),
    source: one("source"),
    from: one("from"),
    to: one("to"),
    filter:
      filter === "check" || filter === "breached" || filter === "mine"
        ? filter
        : undefined,
    mine: one("mine") === "1",
    overdue: one("overdue") === "1",
    q: one("q"),
  };
}

/** The query that keeps the view and the search (the filter sheet adds its own). */
function baseQuery(f: LeadFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.view && f.view !== "inbox") out.view = f.view;
  if (f.q) out.q = f.q;
  return out;
}

function chipHref(f: LeadFilter, view: LeadView | null): string {
  const sp = new URLSearchParams();
  if (view) sp.set("view", view);
  if (f.q) sp.set("q", f.q);
  if (f.source) sp.set("source", f.source);
  if (f.mine) sp.set("mine", "1");
  if (f.overdue) sp.set("overdue", "1");
  const s = sp.toString();
  return s ? `/leads?${s}` : "/leads";
}

const CHIPS: { view: LeadView; label: string }[] = [
  { view: "new", label: "New" },
  { view: "contacted", label: "Contacted" },
  { view: "qualified", label: "Qualified" },
  { view: "check", label: "Check" },
  { view: "booked", label: "Booked" },
  { view: "lost", label: "Lost" },
  { view: "spam", label: "Spam" },
];

/** Status chips with counts; sources, Mine and Overdue live in the Filter sheet. */
function LeadChips({
  f,
  counts,
  sources,
}: {
  f: LeadFilter;
  counts: LeadCounts;
  sources: { id: string; name: string }[];
}) {
  const view = f.view ?? "inbox";
  return (
    <ChipRow label="Filter leads">
      <LeadFilterButton
        sources={sources}
        current={{
          mine: !!(f.mine || f.filter === "mine"),
          overdue: !!(f.overdue || f.filter === "breached"),
          source: f.source ?? null,
        }}
        base={baseQuery(f)}
        counts={{ mine: counts.mine, overdue: counts.breached }}
      />
      {CHIPS.filter(
        (c) => c.view !== "check" || counts.check > 0 || view === "check",
      ).map((c) => (
        <Chip
          key={c.view}
          href={chipHref(f, view === c.view ? null : c.view)}
          selected={view === c.view}
          count={counts[c.view]}
          replace
        >
          {c.label}
        </Chip>
      ))}
      <SelectedChipInView selected={view} />
    </ChipRow>
  );
}

const NOUN: Record<LeadView, [string, string]> = {
  inbox: ["open lead", "open leads"],
  new: ["new lead", "new leads"],
  contacted: ["contacted", "contacted"],
  qualified: ["qualified", "qualified"],
  check: ["to check", "to check"],
  booked: ["booked", "booked"],
  lost: ["lost", "lost"],
  spam: ["spam", "spam"],
  all: ["lead", "leads"],
};

function GridSkeleton({ cols }: { cols: LeadCols }) {
  return (
    <div
      aria-hidden
      className={
        cols === 1
          ? "grid gap-3 md:grid-cols-[repeat(auto-fill,minmax(340px,1fr))] lg:grid-cols-1"
          : "grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,minmax(232px,1fr))] lg:grid-cols-1"
      }
    >
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          key={i}
          height={cols === 1 ? 172 : 150}
          rounded="card"
        />
      ))}
    </div>
  );
}

async function LeadGridSection({
  f,
  viewer,
}: {
  f: LeadFilter;
  viewer: SessionUser;
}) {
  const { items, hasMore } = await listLeads(viewer, f);
  if (items.length === 0) {
    const view = f.view ?? "inbox";
    const filtered = !!(
      f.q ||
      f.source ||
      f.filter ||
      f.mine ||
      f.overdue ||
      f.status?.length
    );
    const inbox = view === "inbox" || view === "new";
    return (
      <div className="rounded-card bg-card px-4 py-6 shadow-card">
        <EmptyState
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
              : view === "check"
                ? "Nothing to check"
                : view === "spam"
                  ? "No spam"
                  : "Inbox zero"
          }
          message={
            filtered
              ? "Try another filter or search."
              : inbox
                ? "New requests from your website, marketplaces and phone show up here with a speed-to-lead timer."
                : undefined
          }
          action={
            !filtered && inbox && viewer.perms.has("leads.create") ? (
              <div className="flex flex-col items-center gap-2">
                <Button
                  size="lg"
                  href="/leads/new"
                  transition="push"
                  icon={<Plus size={20} aria-hidden />}
                >
                  New lead
                </Button>
                {viewer.perms.has("settings.api_keys") && (
                  <Button
                    variant="plain"
                    size="sm"
                    href="/settings/lead-sources"
                  >
                    Connect your website
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
      </div>
    );
  }
  return <LeadsGrid items={items} hasMore={hasMore} filter={f} />;
}

/**
 * The leads inbox (leads-flow items 1–3 and 10): a grid of lead boxes, 1 or 2
 * columns on phones, as many as fit on wider screens, with the map beside it on
 * desktop; status chips with counts; the lead card slides up over it.
 */
export async function LeadsInbox({
  filter,
  viewer,
  cols,
  show,
  map,
}: {
  filter: LeadFilter;
  viewer: SessionUser;
  cols: LeadCols;
  show: InboxShow;
  /** The lead map's data (`getLeadsMapData`), started by the page. */
  map?: Promise<LeadsMapData | null>;
}) {
  const [counts, sources, settings, count] = await Promise.all([
    leadCounts(viewer),
    listActiveSources(),
    getSettings(),
    countLeads(viewer, filter),
  ]);
  const view = filter.view ?? "inbox";
  const init: LeadEnvInit = {
    viewerId: viewer.id,
    can: {
      edit: viewer.perms.has("leads.edit"),
      convert: viewer.perms.has("leads.convert"),
      viewCustomers: viewer.perms.has("customers.view"),
    },
    lostReasons: settings.leads.lost_reasons,
    tileUrl: getMapConfig(settings.map).tileUrl,
  };
  const noun = NOUN[view][count === 1 ? 0 : 1];
  return (
    <LeadCardProvider init={init}>
      <LargeTitleHeader
        title="Leads"
        trailing={<HeaderActions />}
        search={
          <SearchField
            param="q"
            defaultValue={filter.q ?? ""}
            placeholder="Name, phone, service"
            label="Search leads"
          />
        }
      />
      <Page wide className="pb-6 lg:max-w-[1480px]">
        <InboxView
          initialCols={cols}
          initialShow={show}
          count={count}
          noun={noun}
          sort={
            view === "inbox" || view === "new"
              ? "Longest wait first"
              : "Newest first"
          }
          chips={<LeadChips f={filter} counts={counts} sources={sources} />}
          map={map}
        >
          <Suspense
            key={JSON.stringify(filter)}
            fallback={<GridSkeleton cols={cols} />}
          >
            <LeadGridSection f={filter} viewer={viewer} />
          </Suspense>
        </InboxView>
      </Page>
    </LeadCardProvider>
  );
}
