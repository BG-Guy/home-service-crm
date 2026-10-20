"use client";

import { BellRing, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { toneStyle } from "@/ui/tone";
import { toggleReminder } from "../actions";
import type { ReminderItem } from "../queries";

const loadEditor = () => import("./ReminderEditorSheet");
const ReminderEditorSheet = dynamic(loadEditor, { ssr: false });

/** Settings → Reminders (SPEC M13): admin-defined reminders on any schedule. */
export function RemindersManager({
  items,
  users,
  roles,
  vehicles,
  timeZone,
}: {
  items: ReminderItem[];
  users: { id: string; name: string }[];
  roles: { key: string; name: string }[];
  vehicles: { id: string; name: string }[];
  timeZone: string;
}) {
  // The editor mounts on first open (its chunk loads on intent: hover/press).
  const [editing, setEditing] = useState<{
    item: ReminderItem | null;
    n: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (item: ReminderItem | null) => {
    setEditing((p) => ({ item, n: (p?.n ?? 0) + 1 }));
    setOpen(true);
  };
  const preload = () => void loadEditor();

  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(iso))
      : null;

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <div className="flex justify-end">
        <Button
          variant="tinted"
          size="sm"
          icon={<Plus aria-hidden size={16} />}
          onPointerEnter={preload}
          onFocus={preload}
          onClick={() => edit(null)}
        >
          New reminder
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<BellRing aria-hidden size={44} />}
          title="No reminders yet"
          message="Examples: every Monday at 8:00 remind techs to upload fuel receipts; remind a customer every 12 months about dryer-vent cleaning."
        />
      ) : (
        <ListSection header="Your reminders">
          {items.map((r) => (
            <div
              key={r.id}
              className="list-row flex min-h-[52px] items-center gap-3 pr-4"
            >
              <button
                type="button"
                onPointerEnter={preload}
                onPointerDown={preload}
                onFocus={preload}
                onClick={() => edit(r)}
                className="pressable flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
              >
                <span
                  aria-hidden
                  className="icon-tile tint-bg tint-fg"
                  style={toneStyle(r.active ? "orange" : "gray")}
                >
                  <BellRing size={17} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium text-label">
                    {r.title}
                  </span>
                  <span className="truncate text-subhead text-label-2">
                    {r.recurrenceLabel} · {r.audienceLabel} · {r.channel}
                    {r.active && r.nextAt ? ` · next ${fmt(r.nextAt)}` : ""}
                  </span>
                </span>
              </button>
              <Toggle
                label={`${r.title} on/off`}
                defaultChecked={r.active}
                onChange={async (e) => {
                  const res = await toggleReminder({
                    id: r.id,
                    active: e.currentTarget.checked,
                  });
                  if (!res.ok)
                    toast({
                      title: "Couldn't change it",
                      message: res.error,
                      tone: "error",
                    });
                }}
              />
            </div>
          ))}
        </ListSection>
      )}

      {editing && (
        <ReminderEditorSheet
          key={editing.n}
          open={open}
          item={editing.item}
          users={users}
          roles={roles}
          vehicles={vehicles}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
