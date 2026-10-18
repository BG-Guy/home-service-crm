"use client";

import { BellOff, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDaysToKey, dateKey, formatDayShort, formatTime } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import {
  loadMoreNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions";
import type { NotificationDTO } from "../contracts";

/** /notifications: grouped by day, deep links, mark all read, cursor paging. */
export function NotificationsList({
  initial,
  timeZone,
}: {
  initial: { items: NotificationDTO[]; nextBefore: string | null };
  timeZone: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [next, setNext] = useState(initial.nextBefore);
  const [busy, setBusy] = useState<null | "all" | "more">(null);
  const unread = items.filter((n) => !n.read).length;

  const open = async (n: NotificationDTO) => {
    if (!n.read) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      );
      void markNotificationRead({ id: n.id });
    }
    if (n.url) router.push(n.url);
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
  const groups: { key: string; items: NotificationDTO[] }[] = [];
  for (const n of items) {
    const k = dateKey(n.at, timeZone);
    const g = groups[groups.length - 1];
    if (g && g.key === k) g.items.push(n);
    else groups.push({ key: k, items: [n] });
  }
  const label = (k: string, at: string) =>
    k === today
      ? "Today"
      : k === yesterday
        ? "Yesterday"
        : formatDayShort(at, timeZone);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex items-center justify-between px-1">
        <p className="text-subhead text-label-2">
          {unread > 0 ? `${unread} unread` : "All read"}
        </p>
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
      </div>
      {groups.map((g) => (
        <ListSection key={g.key} header={label(g.key, g.items[0]?.at ?? "")}>
          {g.items.map((n) => (
            <ListRow
              key={n.id}
              leading={
                <span
                  aria-hidden
                  className={cx(
                    "size-2.5 shrink-0 rounded-full",
                    n.read
                      ? "bg-transparent"
                      : n.priority === "high"
                        ? "bg-danger"
                        : "bg-accent",
                  )}
                />
              }
              title={
                <span className={cx(!n.read && "font-semibold")}>
                  {!n.read && <span className="sr-only">Unread: </span>}
                  {n.title}
                </span>
              }
              subtitle={n.body ?? undefined}
              detail={formatTime(n.at, timeZone)}
              multiline
              onClick={() => open(n)}
              accessory={n.url ? "chevron" : "none"}
            />
          ))}
        </ListSection>
      ))}
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
    </div>
  );
}
