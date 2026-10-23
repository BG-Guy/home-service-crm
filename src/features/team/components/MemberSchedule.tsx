"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { FieldCard } from "@/features/settings/components/form";
import {
  hhmmMinutes,
  hoursOn,
  type WorkHoursDay,
  workHoursSummary,
} from "@/lib/work-hours";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { DateField, TextField, TimeField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { Toggle, ToggleRow } from "@/ui/components/Toggle";
import { haptic } from "@/ui/motion/haptics";
import {
  addTimeOffAction,
  removeTimeOffAction,
  saveWorkHoursAction,
} from "../schedule-actions";

// Team member page: Working hours and Time off (leads-flow redesign, item 8).
// Booking only opens arrival windows when a tech works then and isn't off.

/** Monday first, like the summary. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

interface DayDraft {
  on: boolean;
  start: string;
  end: string;
}

function draftFrom(rows: readonly WorkHoursDay[]): DayDraft[] {
  return DAY_SHORT.map((_, day) => {
    const r = hoursOn(rows, day)[0];
    return r
      ? { on: true, start: r.start, end: r.end }
      : { on: false, start: "08:00", end: "17:00" };
  });
}

/* ------------------------------------------------------------------ working hours */

export function WorkHoursSection({
  userId,
  firstName,
  workHours,
  business,
}: {
  userId: string;
  firstName: string;
  /** Their own week, or null = business hours. */
  workHours: WorkHoursDay[] | null;
  business: WorkHoursDay[];
}) {
  const [open, setOpen] = useState(false);
  const week = workHours ?? business;
  return (
    <>
      <ListSection
        header="Working hours"
        footer={`Booking offers ${firstName} jobs in these hours.`}
      >
        <ListRow
          title={workHoursSummary(week)}
          subtitle={workHours ? "Own hours" : "Business hours"}
          multiline
          onClick={() => setOpen(true)}
          accessory="chevron"
        />
      </ListSection>
      {open && (
        <WorkHoursSheet
          userId={userId}
          firstName={firstName}
          workHours={workHours}
          business={business}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function WorkHoursSheet({
  userId,
  firstName,
  workHours,
  business,
  onClose,
}: {
  userId: string;
  firstName: string;
  workHours: WorkHoursDay[] | null;
  business: WorkHoursDay[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [useBiz, setUseBiz] = useState(workHours === null);
  const [days, setDays] = useState(() => draftFrom(workHours ?? business));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();

  const setDay = (day: number, patch: Partial<DayDraft>) => {
    setDays((d) => d.map((x, i) => (i === day ? { ...x, ...patch } : x)));
    setDirty(true);
    if (errors[day]) setErrors(({ [day]: _drop, ...rest }) => rest);
  };

  const save = () => {
    const bad: Record<number, string> = {};
    if (!useBiz)
      days.forEach((d, day) => {
        const s = hhmmMinutes(d.start);
        const e = hhmmMinutes(d.end);
        if (d.on && (s === null || e === null || e <= s))
          bad[day] = "End after the start.";
      });
    if (Object.keys(bad).length) {
      setErrors(bad);
      toast.error("Check the highlighted days.");
      return;
    }
    start(async () => {
      const r = await saveWorkHoursAction({
        userId,
        useBusinessHours: useBiz,
        days: useBiz
          ? []
          : days.flatMap((d, day) =>
              d.on ? [{ day, start: d.start, end: d.end }] : [],
            ),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      haptic();
      toast.success("Working hours saved");
      setDirty(false);
      setOpen(false);
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      dirty={dirty}
      title="Working hours"
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          loading={pending}
          onClick={save}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <ListSection footer="Business hours are set in Settings → Company.">
          <ToggleRow
            title="Use business hours"
            subtitle={workHoursSummary(business)}
            checked={useBiz}
            onChange={(e) => {
              setUseBiz(e.target.checked);
              setDirty(true);
            }}
          />
        </ListSection>
        {!useBiz && (
          <ListSection
            header={`${firstName}'s week`}
            footer="Days switched off get no bookings, unless after-hours booking is on in Settings → Jobs & scheduling."
          >
            {WEEK.map((day) => {
              const d = days[day] as DayDraft;
              return (
                // Phones: day + switch on one line, the times under them (each
                // time gets half the width). Wider: one line.
                <div
                  key={day}
                  className="list-row flex min-h-[var(--row-min)] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2"
                >
                  <span className="order-1 w-10 shrink-0 text-body font-semibold">
                    {DAY_SHORT[day]}
                  </span>
                  {!d.on && (
                    <span className="order-2 flex-1 text-body text-label-2">
                      Off
                    </span>
                  )}
                  {d.on && (
                    <div className="order-4 flex min-w-0 basis-full items-center gap-2 sm:order-2 sm:basis-0 sm:flex-1">
                      <TimeField
                        label={`${DAY_LONG[day]} start`}
                        hideLabel
                        value={d.start}
                        onChange={(e) => setDay(day, { start: e.target.value })}
                        className="min-w-0 flex-1"
                      />
                      <span aria-hidden className="text-label-2">
                        –
                      </span>
                      <TimeField
                        label={`${DAY_LONG[day]} end`}
                        hideLabel
                        value={d.end}
                        error={errors[day]}
                        onChange={(e) => setDay(day, { end: e.target.value })}
                        className="min-w-0 flex-1"
                      />
                    </div>
                  )}
                  <Toggle
                    label={`Works ${DAY_LONG[day]}`}
                    checked={d.on}
                    onChange={(e) => setDay(day, { on: e.target.checked })}
                    className="order-3 ms-auto"
                  />
                </div>
              );
            })}
          </ListSection>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ time off */

export interface TimeOffItem {
  id: string;
  label: string;
  note: string | null;
  allDay: boolean;
  current: boolean;
}

export function TimeOffSection({
  userId,
  firstName,
  entries,
  today,
}: {
  userId: string;
  firstName: string;
  /** Time off that hasn't ended, soonest first. */
  entries: TimeOffItem[];
  /** Company-time-zone 'YYYY-MM-DD'. */
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const [, start] = useTransition();

  const remove = async (e: TimeOffItem) => {
    const ok = await confirm({
      title: "Remove time off?",
      message: `${e.label}${e.note ? ` · ${e.note}` : ""}`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await removeTimeOffAction({ id: e.id });
      if (r.ok) toast.success("Time off removed");
      else toast.error(r.error);
    });
  };

  return (
    <>
      <ListSection
        header="Time off"
        footer={`No jobs are booked for ${firstName} during time off.`}
      >
        {entries.map((e) => (
          <SwipeActions
            key={e.id}
            trailing={[
              {
                label: "Remove",
                icon: <Trash2 aria-hidden size={18} />,
                destructive: true,
                onAction: () => void remove(e),
              },
            ]}
          >
            <ListRow
              title={e.label}
              subtitle={e.note ?? (e.allDay ? "All day" : undefined)}
              detail={
                e.current ? (
                  <Pill tone="orange" size="sm">
                    Now
                  </Pill>
                ) : undefined
              }
              accessory={
                <IconButton
                  label={`Remove time off: ${e.label}`}
                  variant="plain"
                  size={36}
                  destructive
                  onClick={() => void remove(e)}
                >
                  <Trash2 aria-hidden size={18} />
                </IconButton>
              }
            />
          </SwipeActions>
        ))}
        {entries.length === 0 && (
          <ListRow
            title={<span className="text-label-2">No time off coming up</span>}
          />
        )}
        <ListRow
          icon={<Plus aria-hidden size={18} />}
          title="Add time off"
          onClick={() => setAdding(true)}
          accessory="none"
        />
      </ListSection>
      {adding && (
        <TimeOffSheet
          userId={userId}
          today={today}
          onClose={() => setAdding(false)}
        />
      )}
      {confirmEl}
    </>
  );
}

function TimeOffSheet({
  userId,
  today,
  onClose,
}: {
  userId: string;
  today: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("17:00");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const dirty = from !== today || to !== today || !allDay || note !== "";

  const save = () => {
    const bad: Record<string, string> = {};
    if (!from) bad.from = "Pick a date.";
    if (!to) bad.to = "Pick a date.";
    else if (from && to < from) bad.to = "End on or after the first day.";
    if (!allDay && from === to && endTime <= startTime)
      bad.endTime = "End after the start.";
    if (Object.keys(bad).length) {
      setErrors(bad);
      return;
    }
    start(async () => {
      const r = await addTimeOffAction({
        userId,
        from,
        to,
        allDay,
        ...(allDay ? {} : { startTime, endTime }),
        note: note.trim() || undefined,
      });
      if (!r.ok) {
        setErrors(
          Object.fromEntries(
            Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0]]),
          ) as Record<string, string>,
        );
        toast.error(r.error);
        return;
      }
      haptic();
      toast.success("Time off added");
      setOpen(false);
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      dirty={dirty}
      title="Add time off"
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          loading={pending}
          onClick={save}
          className="font-semibold"
        >
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <FieldCard>
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="From"
              value={from}
              min={today}
              error={errors.from}
              onChange={(e) => {
                const v = e.target.value;
                setFrom(v);
                if (v && to < v) setTo(v);
              }}
            />
            <DateField
              label="To"
              value={to}
              min={from || today}
              error={errors.to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </FieldCard>
        <ListSection>
          <ToggleRow
            title="All day"
            subtitle={
              allDay
                ? "Off the whole day"
                : "From the start time on the first day to the end time on the last"
            }
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
        </ListSection>
        {!allDay && (
          <FieldCard>
            <div className="grid grid-cols-2 gap-3">
              <TimeField
                label="Starts"
                value={startTime}
                error={errors.startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <TimeField
                label="Ends"
                value={endTime}
                error={errors.endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </FieldCard>
        )}
        <FieldCard>
          <TextField
            label="Note"
            value={note}
            maxLength={200}
            placeholder="Vacation, appointment…"
            onChange={(e) => setNote(e.target.value)}
          />
        </FieldCard>
      </div>
    </Sheet>
  );
}
