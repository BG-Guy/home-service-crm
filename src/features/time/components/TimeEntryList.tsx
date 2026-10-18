"use client";

import { Clock, MapPin, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { dateKey, formatDateKey, formatInTz } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { DateField } from "@/ui/components/DatePicker";
import { TextArea, TextField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { TimeField } from "@/ui/components/TimePicker";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import { addTimeEntry, editTimeEntry } from "../actions";
import { formatMinutes } from "../format";
import type { TimeEntryView } from "../queries";

// Time entries grouped by day (S6 and /time). Managers (time.manage) edit or add
// entries; every change needs a reason and is audited server-side.

const hm = (iso: string, tz: string) =>
  formatInTz(iso, tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type Draft = {
  id: string | null;
  inDate: string;
  inTime: string;
  outDate: string;
  outTime: string;
  breakMinutes: number;
  reason: string;
};

export function TimeEntryList({
  entries,
  tz,
  canManage,
  userId,
  showAdd = false,
  emptyText = "No time entries in this period.",
}: {
  entries: TimeEntryView[];
  tz: string;
  canManage: boolean;
  userId: string;
  showAdd?: boolean;
  emptyText?: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const groups: { key: string; items: TimeEntryView[]; minutes: number }[] = [];
  for (const e of entries) {
    const k = dateKey(e.clockInAt, tz);
    const last = groups[groups.length - 1];
    if (last && last.key === k) {
      last.items.push(e);
      last.minutes += e.minutes;
    } else groups.push({ key: k, items: [e], minutes: e.minutes });
  }

  const openEdit = (e: TimeEntryView) =>
    setDraft({
      id: e.id,
      inDate: dateKey(e.clockInAt, tz),
      inTime: hm(e.clockInAt, tz),
      outDate: e.clockOutAt ? dateKey(e.clockOutAt, tz) : "",
      outTime: e.clockOutAt ? hm(e.clockOutAt, tz) : "",
      breakMinutes: e.breakMinutes,
      reason: "",
    });
  const openAdd = () => {
    const today = dateKey(new Date(), tz);
    setDraft({
      id: null,
      inDate: today,
      inTime: "08:00",
      outDate: today,
      outTime: "17:00",
      breakMinutes: 30,
      reason: "",
    });
  };

  const save = () =>
    start(async () => {
      if (!draft) return;
      const payload = {
        clockIn: `${draft.inDate}T${draft.inTime}`,
        clockOut:
          draft.outDate && draft.outTime
            ? `${draft.outDate}T${draft.outTime}`
            : "",
        breakMinutes: draft.breakMinutes,
        reason: draft.reason,
      };
      const r = draft.id
        ? await editTimeEntry({ ...payload, entryId: draft.id })
        : await addTimeEntry({ ...payload, userId });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      haptic();
      setErrors({});
      setDraft(null);
      toast.success(draft.id ? "Entry updated" : "Entry added");
    });

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {showAdd && canManage && (
        <div className="flex justify-end px-1">
          <Button
            size="sm"
            variant="tinted"
            icon={<Plus size={16} aria-hidden />}
            onClick={openAdd}
          >
            Add entry
          </Button>
        </div>
      )}
      {groups.length === 0 ? (
        <ListSection>
          <p className="px-4 py-3 text-subhead text-label-2">{emptyText}</p>
        </ListSection>
      ) : (
        groups.map((g) => (
          <ListSection
            key={g.key}
            header={formatDateKey(g.key, "en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            trailing={
              <span className="num text-footnote text-label-2">
                {formatMinutes(g.minutes)}
              </span>
            }
          >
            {g.items.map((e) => {
              const body = (
                <>
                  <span className="flex size-[29px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--sys-teal)] text-white">
                    <Clock size={16} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col py-2.5">
                    <span className="num text-body">
                      {formatInTz(e.clockInAt, tz, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {e.clockOutAt
                        ? formatInTz(e.clockOutAt, tz, {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "now"}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-footnote text-label-2">
                      {e.breakMinutes > 0 && (
                        <span>{e.breakMinutes} min break</span>
                      )}
                      {e.hasGeo && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin size={11} aria-hidden /> Geostamped
                        </span>
                      )}
                      {e.hasOdometer && <span>Odometer logged</span>}
                      {e.editReason && (
                        <span className="truncate">
                          Edited{e.editedByName ? ` by ${e.editedByName}` : ""}:{" "}
                          {e.editReason}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {e.clockOutAt ? (
                      <span className="num text-subhead text-label-2">
                        {formatMinutes(e.minutes)}
                      </span>
                    ) : (
                      <Pill tone="green" size="sm">
                        Clocked in
                      </Pill>
                    )}
                  </span>
                  {canManage && (
                    <Pencil
                      size={14}
                      className="shrink-0 text-label-3"
                      aria-hidden
                    />
                  )}
                </>
              );
              return canManage ? (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEdit(e)}
                  aria-label="Edit time entry"
                  className="list-row row-press flex min-h-[56px] w-full items-center gap-3 pl-4 pr-3 text-left outline-offset-[-2px]"
                >
                  {body}
                </button>
              ) : (
                <div
                  key={e.id}
                  className="list-row flex min-h-[56px] items-center gap-3 pl-4 pr-3"
                >
                  {body}
                </div>
              );
            })}
          </ListSection>
        ))
      )}

      {draft && (
        <Sheet
          open
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? "Edit time entry" : "Add time entry"}
          detents={["content"]}
          dirty
          leading={
            <Button variant="plain" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          }
          footer={
            <Button
              size="lg"
              fullWidth
              loading={pending}
              disabled={draft.reason.trim().length < 3}
              onClick={save}
            >
              Save
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <DateField
              label="Clock-in date"
              value={draft.inDate}
              onChange={(ev) => setDraft({ ...draft, inDate: ev.target.value })}
              error={errors.clockIn?.[0]}
            />
            <TimeField
              label="Time"
              value={draft.inTime}
              onChange={(ev) => setDraft({ ...draft, inTime: ev.target.value })}
            />
            <DateField
              label="Clock-out date"
              value={draft.outDate}
              onChange={(ev) =>
                setDraft({ ...draft, outDate: ev.target.value })
              }
              error={errors.clockOut?.[0]}
            />
            <TimeField
              label="Time"
              value={draft.outTime}
              onChange={(ev) =>
                setDraft({ ...draft, outTime: ev.target.value })
              }
            />
            <TextField
              label="Break (minutes)"
              type="number"
              inputMode="numeric"
              min={0}
              max={600}
              className="col-span-2"
              value={String(draft.breakMinutes)}
              onChange={(ev) =>
                setDraft({
                  ...draft,
                  breakMinutes: Math.max(0, Number(ev.target.value) || 0),
                })
              }
            />
            <TextArea
              label="Reason for the change"
              className="col-span-2"
              placeholder="e.g. Forgot to clock out"
              value={draft.reason}
              maxLength={500}
              rows={2}
              error={errors.reason?.[0]}
              onChange={(ev) => setDraft({ ...draft, reason: ev.target.value })}
            />
            <p className="col-span-2 text-footnote text-label-2">
              Times are in the company time zone. Edits are saved to the audit
              log.
            </p>
          </div>
        </Sheet>
      )}
    </div>
  );
}
