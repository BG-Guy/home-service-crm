"use client";

import {
  Briefcase,
  CalendarClock,
  Plus,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { ROW_SEP } from "@/features/jobs/components/sep";
import { dateKey, formatInTz } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import {
  DateField,
  Select,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { createTaskAction, setTaskStatus, updateTaskAction } from "../actions";
import type { TaskView } from "../queries";

// Task rows (tap the circle to finish, swipe to dismiss or reopen, tap to edit)
// plus the create/edit sheet. Used by /tasks and the tech's My Day.

const KIND_LABEL: Record<string, string> = {
  lead_retry: "Lead follow-up",
  warranty_claim: "Warranty claim",
  restock: "Restock",
  callback_customer: "Call customer",
  refund_due: "Refund due",
  follow_up: "Follow up",
  custom: "Task",
};

type Draft = {
  id: string | null;
  title: string;
  body: string;
  dueDate: string;
  dueTime: string;
  assigneeUserId: string;
  kind: "custom" | "follow_up" | "callback_customer";
  jobId?: string | null;
};

export function TaskList({
  tasks,
  tz,
  viewerId,
  users,
  canAssign,
  allowCreate = false,
  jobId,
  emptyText = "Nothing to do. Nice.",
  compact = false,
}: {
  tasks: TaskView[];
  tz: string;
  viewerId: string;
  users: { id: string; name: string }[];
  canAssign: boolean;
  allowCreate?: boolean;
  jobId?: string;
  emptyText?: string;
  compact?: boolean;
}) {
  const [list, patch] = useOptimistic(
    tasks,
    (cur, p: { id: string; status: TaskView["status"] }) =>
      cur.map((t) => (t.id === p.id ? { ...t, status: p.status } : t)),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const today = dateKey(new Date(), tz);

  const setStatus = (t: TaskView, status: TaskView["status"]) =>
    start(async () => {
      if (status === "done") haptic();
      patch({ id: t.id, status });
      const r = await setTaskStatus({ taskId: t.id, status });
      if (!r.ok) toast.error(r.error);
      else if (status === "done") toast.success("Done", { message: t.title });
    });

  const openNew = () =>
    setDraft({
      id: null,
      title: "",
      body: "",
      dueDate: "",
      dueTime: "",
      assigneeUserId: viewerId,
      kind: "custom",
      jobId: jobId ?? null,
    });
  const openEdit = (t: TaskView) =>
    setDraft({
      id: t.id,
      title: t.title,
      body: t.body ?? "",
      dueDate: t.dueAt ? dateKey(t.dueAt, tz) : "",
      dueTime: t.dueAt
        ? formatInTz(t.dueAt, tz, {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
        : "",
      assigneeUserId: t.assigneeUserId ?? "",
      kind: "custom",
    });

  const save = () =>
    start(async () => {
      if (!draft) return;
      const common = {
        title: draft.title,
        body: draft.body || null,
        dueDate: draft.dueDate || null,
        dueTime: draft.dueTime || null,
        assigneeUserId: draft.assigneeUserId || null,
      };
      const r = draft.id
        ? await updateTaskAction({ ...common, taskId: draft.id })
        : await createTaskAction({
            ...common,
            kind: draft.kind,
            jobId: draft.jobId ?? null,
          });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      haptic();
      setErrors({});
      setDraft(null);
      toast.success(draft.id ? "Task updated" : "Task added");
    });

  const dueLabel = (t: TaskView) => {
    if (!t.dueAt) return null;
    const k = dateKey(t.dueAt, tz);
    const time = formatInTz(t.dueAt, tz, {
      hour: "numeric",
      minute: "2-digit",
    });
    const overdue = t.status === "open" && new Date(t.dueAt) < new Date();
    const label =
      k === today
        ? `Today ${time}`
        : formatInTz(t.dueAt, tz, {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
    return { label, overdue };
  };

  return (
    <div className="flex flex-col">
      {list.length === 0 && (
        <p className="list-row px-4 py-3 text-subhead text-label-2">
          {emptyText}
        </p>
      )}
      <ul className="flex flex-col">
        {list.map((t) => {
          const due = dueLabel(t);
          const closed = t.status !== "open";
          const row = (
            <div
              className={cx(
                "list-row flex min-h-[56px] items-start gap-3 bg-card pl-2 pr-4",
                closed && "opacity-60",
              )}
            >
              <button
                type="button"
                aria-pressed={t.status === "done"}
                aria-label={
                  t.status === "done"
                    ? `Reopen ${t.title}`
                    : `Mark ${t.title} done`
                }
                onClick={() =>
                  setStatus(t, t.status === "open" ? "done" : "open")
                }
                className="flex size-11 shrink-0 items-center justify-center"
              >
                <span
                  className={cx(
                    "flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color] duration-300 ease-[var(--ease-spring)]",
                    t.status === "done"
                      ? "border-transparent bg-accent text-on-accent"
                      : "border-label-3",
                  )}
                >
                  {t.status === "done" && (
                    <svg
                      viewBox="0 0 12 12"
                      className="size-3"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 6.2 5 8.5l4.5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => openEdit(t)}
                className="flex min-w-0 flex-1 flex-col items-start py-2.5 text-left outline-offset-[-2px]"
              >
                <span className={cx("text-body", closed && "line-through")}>
                  {t.title}
                </span>
                {!compact && t.body && (
                  <span className="line-clamp-2 text-subhead text-label-2">
                    {t.body}
                  </span>
                )}
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote text-label-2">
                  {t.kind !== "custom" && (
                    <Pill tone="gray" size="sm" dot={false}>
                      {KIND_LABEL[t.kind] ?? t.kind}
                    </Pill>
                  )}
                  {due && (
                    <span
                      className={cx(
                        "inline-flex items-center gap-0.5",
                        due.overdue && "text-[var(--sys-red)]",
                      )}
                    >
                      <CalendarClock size={12} aria-hidden /> {due.label}
                    </span>
                  )}
                  {t.assigneeUserId !== viewerId && (
                    <span className="inline-flex items-center gap-0.5">
                      <User size={12} aria-hidden />{" "}
                      {t.assigneeName ?? "Office queue"}
                    </span>
                  )}
                  {t.status === "dismissed" && <span>Dismissed</span>}
                </span>
              </button>
              {t.jobId && t.jobNumber && (
                <Link
                  href={`/jobs/${t.jobId}`}
                  className="mt-2.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-footnote text-label-2"
                >
                  <Briefcase size={12} aria-hidden /> {t.jobNumber}
                </Link>
              )}
            </div>
          );
          return (
            <li key={t.id} className={ROW_SEP}>
              <SwipeActions
                trailing={
                  t.status === "open"
                    ? [
                        {
                          label: "Dismiss",
                          icon: <Trash2 size={18} />,
                          destructive: true,
                          onAction: () => setStatus(t, "dismissed"),
                        },
                      ]
                    : [
                        {
                          label: "Reopen",
                          icon: <RotateCcw size={18} />,
                          tone: "blue",
                          onAction: () => setStatus(t, "open"),
                        },
                      ]
                }
              >
                {row}
              </SwipeActions>
            </li>
          );
        })}
      </ul>
      {allowCreate && (
        <button
          type="button"
          onClick={openNew}
          className={cx(
            "row-press flex min-h-11 items-center gap-3 px-4 text-left text-body text-accent",
            list.length > 0 && "border-t-[0.5px] border-[var(--sep)]",
          )}
        >
          <Plus size={20} aria-hidden /> New task
        </button>
      )}

      {draft && (
        <Sheet
          open
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? "Edit task" : "New task"}
          detents={["content"]}
          dirty={!!draft.title}
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
              disabled={!draft.title.trim()}
              onClick={save}
            >
              {draft.id ? "Save" : "Add task"}
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <TextField
              label="Title"
              className="col-span-2"
              value={draft.title}
              maxLength={200}
              autoFocus
              error={errors.title?.[0]}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <TextArea
              label="Details"
              className="col-span-2"
              rows={2}
              maxLength={4000}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <DateField
              label="Due"
              value={draft.dueDate}
              onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
            />
            <TimeField
              label="Time"
              value={draft.dueTime}
              onChange={(e) => setDraft({ ...draft, dueTime: e.target.value })}
            />
            {canAssign && (
              <Select
                label="Assign to"
                className="col-span-2"
                value={draft.assigneeUserId}
                placeholder="Office queue (unassigned)"
                options={users.map((u) => ({
                  value: u.id,
                  label: u.id === viewerId ? `${u.name} (me)` : u.name,
                }))}
                onChange={(e) =>
                  setDraft({ ...draft, assigneeUserId: e.target.value })
                }
              />
            )}
            {!draft.id && (
              <Select
                label="Type"
                className="col-span-2"
                value={draft.kind}
                options={[
                  { value: "custom", label: "Task" },
                  { value: "follow_up", label: "Follow up" },
                  { value: "callback_customer", label: "Call customer" },
                ]}
                onChange={(e) =>
                  setDraft({ ...draft, kind: e.target.value as Draft["kind"] })
                }
              />
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
