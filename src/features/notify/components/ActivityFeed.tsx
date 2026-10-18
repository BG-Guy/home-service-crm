"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  Circle,
  DollarSign,
  FileText,
  Hammer,
  Inbox,
  MessageSquare,
  PenLine,
  Phone,
  ShieldCheck,
  Star,
  StickyNote,
  Truck,
  User,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { Skeleton } from "@/ui/components/Skeleton";
import { Timeline, type TimelineItem } from "@/ui/components/Timeline";
import { toast } from "@/ui/components/Toast";
import { loadActivity } from "../actions";
import type {
  ActivityItemDTO,
  TimelineFilter,
  TimelineScope,
} from "../contracts";
import { type ActivityIcon, FILTER_LABELS, kindVisual } from "../timeline";

const ICONS: Record<ActivityIcon, typeof Circle> = {
  message: MessageSquare,
  consent: ShieldCheck,
  call: Phone,
  star: Star,
  job: Hammer,
  check: Check,
  x: X,
  doc: FileText,
  lead: UserPlus,
  camera: Camera,
  pen: PenLine,
  money: DollarSign,
  alert: AlertTriangle,
  note: StickyNote,
  truck: Truck,
  wrench: Wrench,
  user: User,
  dot: Circle,
};

function toItem(a: ActivityItemDTO): TimelineItem {
  const v = kindVisual(a.kind);
  const Icon = ICONS[v.icon];
  return {
    id: String(a.id),
    at: a.at,
    title: a.summary,
    actor: a.actor ?? undefined,
    tone: v.tone,
    icon: <Icon size={14} strokeWidth={2.25} />,
    href: a.href ?? undefined,
  };
}

const FILTERS: TimelineFilter[] = ["all", "messages", "jobs", "money", "notes"];

/** S33 body: filter chips + day-grouped timeline + cursor "Show more". */
export function ActivityFeed({
  scope,
  initial,
  initialFilter = "all",
  showFilterChips = true,
  limit = 25,
  timeZone,
}: {
  scope: TimelineScope;
  initial: { items: ActivityItemDTO[]; nextBefore: number | null };
  initialFilter?: TimelineFilter;
  showFilterChips?: boolean;
  limit?: number;
  timeZone: string;
}) {
  const [filter, setFilter] = useState<TimelineFilter>(initialFilter);
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.nextBefore);
  const [loading, setLoading] = useState<null | "filter" | "more">(null);

  const fetchPage = async (f: TimelineFilter, before: number | null) => {
    const res = await loadActivity({
      customerId: scope.customerId,
      jobId: scope.jobId,
      entityType: scope.entity?.type as never,
      entityId: scope.entity?.id,
      filter: f,
      before,
      limit,
    });
    if (!res.ok || !res.data) {
      toast({
        title: "Couldn't load activity",
        message: res.ok ? undefined : res.error,
        tone: "error",
      });
      return null;
    }
    return res.data;
  };

  const changeFilter = async (f: TimelineFilter) => {
    if (f === filter) return;
    setFilter(f);
    setLoading("filter");
    const page = await fetchPage(f, null);
    setLoading(null);
    if (page) {
      setItems(page.items);
      setNext(page.nextBefore);
    }
  };

  const more = async () => {
    if (!next) return;
    setLoading("more");
    const page = await fetchPage(filter, next);
    setLoading(null);
    if (page) {
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextBefore);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {showFilterChips && (
        <ChipRow label="Filter activity">
          {FILTERS.map((f) => (
            <Chip
              key={f}
              selected={filter === f}
              onClick={() => changeFilter(f)}
            >
              {FILTER_LABELS[f]}
            </Chip>
          ))}
        </ChipRow>
      )}
      {loading === "filter" ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton height={44} rounded="card" />
          <Skeleton height={44} rounded="card" />
          <Skeleton height={44} rounded="card" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox aria-hidden size={32} />}
          title="Nothing here yet"
          message={
            filter === "all"
              ? "Calls, messages, visits and payments will show up as they happen."
              : `No ${FILTER_LABELS[filter].toLowerCase()} activity yet.`
          }
        />
      ) : (
        <Timeline items={items.map(toItem)} timeZone={timeZone} />
      )}
      {next && loading !== "filter" && (
        <Button
          variant="gray"
          size="sm"
          className="self-center"
          loading={loading === "more"}
          onClick={more}
        >
          Show more
        </Button>
      )}
    </div>
  );
}
