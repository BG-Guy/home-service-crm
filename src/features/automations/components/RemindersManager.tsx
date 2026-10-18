"use client";

import { BellRing, Plus } from "lucide-react";
import { useState } from "react";
import { CustomerPicker } from "@/features/customers/slots.client";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import {
  DateField,
  Select,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { deleteReminder, saveReminder, toggleReminder } from "../actions";
import type { ReminderItem } from "../queries";
import { RECURRENCE_LABELS, type Recurrence } from "../recurrence";

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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, dialog] = useConfirm();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!draft) return;
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
      setDraft(null);
    } else toast({ title: "Not saved", message: res.error, tone: "error" });
  };

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
          onClick={() => setDraft(blank())}
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
        <ListSection>
          {items.map((r) => (
            <div
              key={r.id}
              className="list-row flex min-h-11 items-center gap-3 pr-4"
            >
              <button
                type="button"
                onClick={() => setDraft(fromItem(r))}
                className="flex min-w-0 flex-1 flex-col py-2.5 pl-4 text-left"
              >
                <span className="truncate text-body text-label">{r.title}</span>
                <span className="truncate text-subhead text-label-2">
                  {r.recurrenceLabel} · {r.audienceLabel} · {r.channel}
                  {r.active && r.nextAt ? ` · next ${fmt(r.nextAt)}` : ""}
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

      <Sheet
        open={!!draft}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? "Edit reminder" : "New reminder"}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        }
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            disabled={!draft?.title.trim() || saving}
            loading={saving}
            onClick={save}
          >
            Save
          </Button>
        }
      >
        {draft && (
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
                  <DateField
                    label={draft.rtype === "once" ? "Date" : "Starting"}
                    value={draft.date}
                    onChange={(e) => set("date", e.currentTarget.value)}
                  />
                )}
                <TimeField
                  label="Time"
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
                    setDraft(null);
                  }
                }}
              >
                Delete reminder
              </Button>
            )}
          </div>
        )}
      </Sheet>
      {dialog}
    </div>
  );
}
