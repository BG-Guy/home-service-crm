"use client";

import { BellOff, CheckCheck, LayoutGrid, Rows3 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { addDaysToKey, dateKey, formatDayShort, formatTime } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { Select } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { toneStyle } from "@/ui/tone";
import {
  loadMoreNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions";
import type { NotificationDTO } from "../contracts";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type NotifyCategory,
  notifyKind,
} from "../kinds";
import {
  type NotifyLayout,
  type NotifySort,
  writeNotifyLayout,
} from "./notify-prefs";

const NotificationPeekSheet = dynamic(() => import("./NotificationPeekSheet"), {
  ssr: false,
});

const PARAM = "n";
type Filter = "all" | "unread" | NotifyCategory;

const SORTS: { value: NotifySort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "unread", label: "Unread first" },
  { value: "urgent", label: "Urgent first" },
];

/**
 * /notifications: a list (grouped by day) or a grid of cards, each with its
 * type's icon and color; filter chips (Unread, and each kind present) and a sort.
 * Tapping one peeks at it (and marks it read); the peek's button opens its page.
 */
export function NotificationsList({
  initial,
  timeZone,
  initialLayout = "list",
}: {
  initial: { items: NotificationDTO[]; nextBefore: string | null };
  timeZone: string;
  initialLayout?: NotifyLayout;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.nextBefore);
  const [busy, setBusy] = useState<null | "all" | "more">(null);
  const [layout, setLayout] = useState<NotifyLayout>(initialLayout);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<NotifySort>("newest");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const pushed = useRef(false);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (peekId) setUsed(true);
  }, [peekId]);

  const markRead = useCallback((n: NotificationDTO) => {
    if (n.read) return;
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
    );
    void markNotificationRead({ id: n.id });
  }, []);

  // ?n=<id>: the peek, so Back closes it (one pushed entry, null state).
  useEffect(() => {
    const read = () => {
      const id = new URL(window.location.href).searchParams.get(PARAM);
      if (!id) pushed.current = false;
      setPeekId(id);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const peek = (n: NotificationDTO) => {
    markRead(n);
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, n.id);
    if (pushed.current) window.history.replaceState(null, "", url);
    else {
      window.history.pushState(null, "", url);
      pushed.current = true;
    }
    setPeekId(n.id);
  };
  const closePeek = () => {
    setPeekId(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has(PARAM)) {
      url.searchParams.delete(PARAM);
      window.history.replaceState(null, "", url);
    }
  };
  const openPage = (n: NotificationDTO) => {
    if (!n.url) return;
    markRead(n);
    pushed.current = false;
    setPeekId(null);
    router.push(n.url);
  };

  const readAll = async () => {
    setBusy("all");
    const res = await markAllNotificationsRead({});
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
      toast({ title: "All caught up", tone: "success" });
    }
  };

  const more = async () => {
    if (!next) return;
    setBusy("more");
    const res = await loadMoreNotifications({ before: next });
    setBusy(null);
    if (res.ok && res.data) {
      setItems((prev) => [...prev, ...(res.data?.items ?? [])]);
      setNext(res.data.nextBefore);
    }
  };

  // Filter chips: Unread, then each kind that's here (with its count).
  const counts = useMemo(() => {
    const m = new Map<NotifyCategory, number>();
    for (const n of items) {
      const c = notifyKind(n.type).category;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [items]);
  const shown = useMemo(() => {
    const list = items.filter((n) =>
      filter === "all"
        ? true
        : filter === "unread"
          ? !n.read
          : notifyKind(n.type).category === filter,
    );
    const at = (n: NotificationDTO) => Date.parse(n.at);
    const by: Record<
      NotifySort,
      (a: NotificationDTO, b: NotificationDTO) => number
    > = {
      newest: (a, b) => at(b) - at(a),
      oldest: (a, b) => at(a) - at(b),
      unread: (a, b) => Number(a.read) - Number(b.read) || at(b) - at(a),
      urgent: (a, b) =>
        Number(b.priority === "high") - Number(a.priority === "high") ||
        Number(a.read) - Number(b.read) ||
        at(b) - at(a),
    };
    return [...list].sort(by[sort]);
  }, [items, filter, sort]);

  if (items.length === 0)
    return (
      <EmptyState
        icon={<BellOff aria-hidden size={44} />}
        title="No notifications"
        message="New leads, approvals, payments and reminders show up here."
      />
    );

  const today = dateKey(new Date(), timeZone);
  const yesterday = addDaysToKey(today, -1);
  const dayLabel = (k: string, at: string) =>
    k === today
      ? "Today"
      : k === yesterday
        ? "Yesterday"
        : formatDayShort(at, timeZone);
  // By date: day groups; by unread or urgency: one list (each item shows its day).
  const byDay = sort === "newest" || sort === "oldest";
  const groups: { key: string; label: string; items: NotificationDTO[] }[] = [];
  if (byDay)
    for (const n of shown) {
      const k = dateKey(n.at, timeZone);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.items.push(n);
      else groups.push({ key: k, label: dayLabel(k, n.at), items: [n] });
    }
  else
    groups.push({
      key: "all",
      label: SORTS.find((s) => s.value === sort)?.label ?? "",
      items: shown,
    });
  const when = (n: NotificationDTO) =>
    byDay
      ? formatTime(n.at, timeZone)
      : `${dayLabel(dateKey(n.at, timeZone), n.at)} · ${formatTime(n.at, timeZone)}`;

  const peeked = peekId ? (items.find((n) => n.id === peekId) ?? null) : null;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-subhead text-label-2">
            {unread > 0 ? `${unread} unread` : "All read"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="plain"
              size="sm"
              icon={<CheckCheck aria-hidden size={16} />}
              disabled={unread === 0}
              loading={busy === "all"}
              onClick={readAll}
            >
              Mark all read
            </Button>
            <SegmentedControl
              className="w-[92px] shrink-0"
              label="Layout"
              value={layout}
              onChange={(v) => {
                setLayout(v);
                writeNotifyLayout(v);
              }}
              segments={[
                {
                  value: "list",
                  label: (
                    <span className="flex justify-center" title="List">
                      <Rows3 size={17} aria-hidden />
                      <span className="sr-only">List</span>
                    </span>
                  ),
                },
                {
                  value: "cards",
                  label: (
                    <span className="flex justify-center" title="Cards">
                      <LayoutGrid size={17} aria-hidden />
                      <span className="sr-only">Cards</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
        {/* Phones: the chips get the full width, the sort goes under them. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <ChipRow label="Filter notifications" className="min-w-0 flex-1">
            <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
              All
            </Chip>
            <Chip
              selected={filter === "unread"}
              count={unread}
              onClick={() => setFilter(filter === "unread" ? "all" : "unread")}
            >
              Unread
            </Chip>
            {CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => (
              <Chip
                key={c}
                selected={filter === c}
                count={counts.get(c)}
                onClick={() => setFilter(filter === c ? "all" : c)}
              >
                {CATEGORY_LABEL[c]}
              </Chip>
            ))}
          </ChipRow>
          <Select
            label="Sort"
            hideLabel
            className="w-44 shrink-0 self-end sm:self-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as NotifySort)}
            options={SORTS}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<BellOff aria-hidden size={44} />}
          title="Nothing here"
          message="No notifications match this filter."
          action={
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show all
            </Button>
          }
        />
      ) : layout === "cards" ? (
        groups.map((g) => (
          <section
            key={g.key}
            aria-label={g.label}
            className="flex flex-col gap-3"
          >
            <h2 className="px-1 text-title3">{g.label}</h2>
            <ul className="enter-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
              {g.items.map((n, i) => (
                <li
                  key={n.id}
                  className="min-w-0"
                  style={i < 10 ? ({ "--i": i } as CSSProperties) : undefined}
                >
                  <NotifyCard n={n} when={when(n)} onPeek={peek} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        groups.map((g) => (
          <ListSection key={g.key} header={g.label}>
            {g.items.map((n) => (
              <ListRow
                key={n.id}
                leading={<KindIcon n={n} size={36} />}
                title={
                  <span className={cx(!n.read && "font-semibold")}>
                    {!n.read && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </span>
                }
                subtitle={n.body ?? undefined}
                detail={when(n)}
                multiline
                onClick={() => peek(n)}
                accessory="chevron"
              />
            ))}
          </ListSection>
        ))
      )}
      {next && (
        <Button
          variant="gray"
          size="sm"
          className="self-center"
          loading={busy === "more"}
          onClick={more}
        >
          Show older
        </Button>
      )}
      {(used || peekId) && (
        <NotificationPeekSheet
          item={peeked}
          timeZone={timeZone}
          onOpen={openPage}
          onClose={closePeek}
        />
      )}
    </div>
  );
}

/** The type's icon on its tint, with the unread dot on its corner. */
function KindIcon({ n, size }: { n: NotificationDTO; size: 36 | 44 }) {
  const k = notifyKind(n.type);
  const Icon = k.icon;
  return (
    <span className="relative shrink-0" aria-hidden>
      <span
        className={cx(
          "tint-bg tint-fg flex items-center justify-center",
          size === 44 ? "size-11 rounded-[13px]" : "size-9 rounded-[11px]",
        )}
        style={toneStyle(k.tone)}
      >
        <Icon size={size === 44 ? 22 : 19} />
      </span>
      {!n.read && (
        <span
          className={cx(
            "absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card",
            n.priority === "high" ? "bg-danger" : "bg-accent",
          )}
        />
      )}
    </span>
  );
}

function NotifyCard({
  n,
  when,
  onPeek,
}: {
  n: NotificationDTO;
  when: string;
  onPeek(n: NotificationDTO): void;
}) {
  const k = notifyKind(n.type);
  return (
    <article className="hover-lift relative flex h-full flex-col gap-2.5 rounded-card bg-card p-4 shadow-card transition-shadow">
      <div className="flex items-start gap-3">
        <KindIcon n={n} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-footnote font-semibold text-label-2">
            {k.label}
          </p>
          <p className="num text-footnote text-label-2">{when}</p>
        </div>
      </div>
      <h3 className="min-w-0">
        <button
          type="button"
          onClick={() => onPeek(n)}
          className={cx(
            "box-hit text-left text-headline outline-none",
            n.read && "font-normal text-label-2",
          )}
        >
          {!n.read && <span className="sr-only">Unread: </span>}
          {n.title}
        </button>
      </h3>
      {n.body && (
        <p className="line-clamp-2 text-subhead text-label-2">{n.body}</p>
      )}
    </article>
  );
}
