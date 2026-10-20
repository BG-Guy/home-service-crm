"use client";

import { useState } from "react";
import { CustomerPicker } from "@/features/customers/slots.client";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { deleteReminder, saveReminder } from "../actions";
import type { ReminderItem } from "../queries";
import type { Recurrence } from "../recurrence";
import { RECURRENCE_LABELS } from "../recurrence-labels";

// The reminder editor sheet, split out of RemindersManager so its code (and the
// customer picker) loads on first open, not with the list.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Draft {
  id?: string;
  title: string;
  body: string;
  audienceType: "user" | "role" | "customer";
  userId: string;
  role: string;
  customerId: string;
  purpose: "marketing" | "transactional";
  channel: "push" | "email" | "sms" | "in_app";
  rtype: Recurrence["type"];
  time: string;
  date: string;
  days: number[];
  monthDay: number;
  n: number;
  miles: number;
  vehicleId: string;
  active: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

function blank(): Draft {
  return {
    title: "",
    body: "",
    audienceType: "role",
    userId: "",
    role: "tech",
    customerId: "",
    purpose: "marketing",
    channel: "push",
    rtype: "weekly",
    time: "08:00",
    date: today(),
    days: [1],
    monthDay: 1,
    n: 12,
    miles: 5000,
    vehicleId: "",
    active: true,
  };
}

function fromItem(r: ReminderItem): Draft {
  const rec = (r.recurrence ?? {}) as Record<string, unknown>;
  const d = blank();
  return {
    ...d,
    id: r.id,
    title: r.title,
    body: r.body ?? "",
    audienceType: r.audience.type,
    userId: r.audience.type === "user" ? (r.audience.id ?? "") : "",
    role: r.audience.type === "role" ? (r.audience.role ?? "tech") : "tech",
    customerId: r.audience.type === "customer" ? (r.audience.id ?? "") : "",
    purpose:
      r.audience.purpose === "transactional" ? "transactional" : "marketing",
    channel: r.channel as Draft["channel"],
    rtype: (rec.type as Recurrence["type"]) ?? "weekly",
    time: (rec.time as string) ?? d.time,
    date:
      typeof rec.at === "string"
        ? rec.at.slice(0, 10)
        : typeof rec.start === "string"
          ? rec.start
          : d.date,
    days: Array.isArray(rec.days) ? (rec.days as number[]) : d.days,
    monthDay: typeof rec.day === "number" ? rec.day : d.monthDay,
    n: typeof rec.n === "number" ? rec.n : d.n,
    miles: typeof rec.miles === "number" ? rec.miles : d.miles,
    vehicleId: typeof rec.vehicle_id === "string" ? rec.vehicle_id : "",
    active: r.active,
  };
}

function toRecurrence(d: Draft): Recurrence {
  switch (d.rtype) {
    case "once":
      return {
        type: "once",
        at: new Date(`${d.date}T${d.time}:00`).toISOString(),
      };
    case "daily":
      return { type: "daily", time: d.time };
    case "weekly":
      return { type: "weekly", days: d.days, time: d.time };
    case "monthly":
      return { type: "monthly", day: d.monthDay, time: d.time };
    case "every_n_days":
      return { type: "every_n_days", n: d.n, time: d.time, start: d.date };
    case "every_n_months":
      return { type: "every_n_months", n: d.n, time: d.time, start: d.date };
    case "every_n_miles":
      return { type: "every_n_miles", miles: d.miles, vehicle_id: d.vehicleId };
  }
}

export default function ReminderEditorSheet({
  open,
  item,
  users,
  roles,
  vehicles,
  onOpenChange,
}: {
  open: boolean;
  /** The reminder to edit; null for a new one. */
  item: ReminderItem | null;
  users: { id: string; name: string }[];
  roles: { key: string; name: string }[];
  vehicles: { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraftState] = useState<Draft>(() =>
    item ? fromItem(item) : blank(),
  );
  const [saving, setSaving] = useState(false);
  const [confirm, dialog] = useConfirm();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraftState((p) => ({ ...p, [k]: v }));
  const close = () => onOpenChange(false);

  const save = async () => {
    setSaving(true);
    const audience =
      draft.audienceType === "user"
        ? { type: "user" as const, id: draft.userId }
        : draft.audienceType === "role"
          ? { type: "role" as const, role: draft.role }
          : {
              type: "customer" as const,
              id: draft.customerId,
              purpose: draft.purpose,
            };
    const res = await saveReminder({
      id: draft.id,
      title: draft.title,
      body: draft.body || null,
      audience,
      channel:
        draft.audienceType === "customer" && draft.channel === "push"
          ? "sms"
          : draft.channel,
      recurrence: toRecurrence(draft),
      active: draft.active,
    });
    setSaving(false);
    if (res.ok) {
      toast({ title: "Reminder saved", tone: "success" });
      close();
    } else toast({ title: "Not saved", message: res.error, tone: "error" });
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={draft.id ? "Edit reminder" : "New reminder"}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={close}>
            Cancel
          </Button>
        }
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            disabled={!draft.title.trim() || saving}
            loading={saving}
            onClick={save}
          >
            Save
          </Button>
        }
      >
        {
          <div className="flex flex-col gap-4 pb-10">
            <TextField
              label="Title"
              value={draft.title}
              placeholder="Upload your fuel receipts"
              onChange={(e) => set("title", e.currentTarget.value)}
            />
            <TextArea
              label="Message"
              rows={3}
              value={draft.body}
              placeholder="Optional details"
              onChange={(e) => set("body", e.currentTarget.value)}
            />

            <SegmentedControl
              label="Who"
              value={draft.audienceType}
              segments={[
                { value: "role", label: "A team role" },
                { value: "user", label: "One person" },
                { value: "customer", label: "A customer" },
              ]}
              onChange={(v) => set("audienceType", v)}
            />
            {draft.audienceType === "role" && (
              <Select
                label="Role"
                value={draft.role}
                options={roles.map((r) => ({ value: r.key, label: r.name }))}
                onChange={(e) => set("role", e.currentTarget.value)}
              />
            )}
            {draft.audienceType === "user" && (
              <Select
                label="Person"
                value={draft.userId}
                options={[
                  { value: "", label: "Choose…" },
                  ...users.map((u) => ({ value: u.id, label: u.name })),
                ]}
                onChange={(e) => set("userId", e.currentTarget.value)}
              />
            )}
            {draft.audienceType === "customer" && (
              <>
                <CustomerPicker
                  name="reminderCustomer"
                  allowCreate={false}
                  defaultCustomerId={draft.customerId || undefined}
                  onChange={(v) => set("customerId", v.customerId)}
                />
                <SegmentedControl
                  label="Kind"
                  value={draft.purpose}
                  segments={[
                    { value: "marketing", label: "Offer / maintenance" },
                    { value: "transactional", label: "Service notice" },
                  ]}
                  onChange={(v) => set("purpose", v)}
                />
                <p className="px-1 text-footnote text-label-2">
                  Customer reminders follow consent, quiet hours and daily
                  limits. Offers need marketing consent.
                </p>
              </>
            )}

            <Select
              label="Send by"
              value={draft.channel}
              options={
                draft.audienceType === "customer"
                  ? [
                      { value: "sms", label: "Text" },
                      { value: "email", label: "Email" },
                    ]
                  : [
                      { value: "push", label: "Push notification" },
                      { value: "in_app", label: "In-app only" },
                      { value: "email", label: "Email" },
                    ]
              }
              onChange={(e) =>
                set("channel", e.currentTarget.value as Draft["channel"])
              }
            />

            <Select
              label="Repeats"
              value={draft.rtype}
              options={(
                Object.keys(RECURRENCE_LABELS) as Recurrence["type"][]
              ).map((k) => ({
                value: k,
                label: RECURRENCE_LABELS[k],
              }))}
              onChange={(e) =>
                set("rtype", e.currentTarget.value as Recurrence["type"])
              }
            />
            {draft.rtype === "weekly" && (
              <ChipRow label="Days">
                {DAYS.map((d, i) => (
                  <Chip
                    key={d}
                    selected={draft.days.includes(i)}
                    onClick={() =>
                      set(
                        "days",
                        draft.days.includes(i)
                          ? draft.days.filter((x) => x !== i)
                          : [...draft.days, i].sort(),
                      )
                    }
                  >
                    {d}
                  </Chip>
                ))}
              </ChipRow>
            )}
            {draft.rtype === "monthly" && (
              <TextField
                label="Day of the month"
                inputMode="numeric"
                value={String(draft.monthDay)}
                onChange={(e) =>
                  set(
                    "monthDay",
                    Math.min(
                      31,
                      Math.max(1, Number(e.currentTarget.value) || 1),
                    ),
                  )
                }
              />
            )}
            {(draft.rtype === "every_n_days" ||
              draft.rtype === "every_n_months") && (
              <TextField
                label={
                  draft.rtype === "every_n_days"
                    ? "Every how many days"
                    : "Every how many months"
                }
                inputMode="numeric"
                value={String(draft.n)}
                onChange={(e) =>
                  set("n", Math.max(1, Number(e.currentTarget.value) || 1))
                }
              />
            )}
            {draft.rtype === "every_n_miles" ? (
              <>
                <Select
                  label="Vehicle"
                  value={draft.vehicleId}
                  options={[
                    { value: "", label: "Choose…" },
                    ...vehicles.map((v) => ({ value: v.id, label: v.name })),
                  ]}
                  onChange={(e) => set("vehicleId", e.currentTarget.value)}
                />
                <TextField
                  label="Every how many miles"
                  inputMode="numeric"
                  value={String(draft.miles)}
                  onChange={(e) =>
                    set(
                      "miles",
                      Math.max(
                        1,
                        Number(e.currentTarget.value.replace(/\D/g, "")) || 1,
                      ),
                    )
                  }
                />
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(draft.rtype === "once" ||
                  draft.rtype === "every_n_days" ||
                  draft.rtype === "every_n_months") && (
                  <TextField
                    label={draft.rtype === "once" ? "Date" : "Starting"}
                    type="date"
                    value={draft.date}
                    onChange={(e) => set("date", e.currentTarget.value)}
                  />
                )}
                <TextField
                  label="Time"
                  type="time"
                  value={draft.time}
                  onChange={(e) => set("time", e.currentTarget.value)}
                />
              </div>
            )}

            {draft.id && (
              <Button
                variant="plain"
                className="self-start text-danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete this reminder?",
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (!ok || !draft.id) return;
                  const res = await deleteReminder({ id: draft.id });
                  if (res.ok) {
                    toast({ title: "Reminder deleted" });
                    close();
                  }
                }}
              >
                Delete reminder
              </Button>
            )}
          </div>
        }
      </Sheet>
      {dialog}
    </>
  );
}
