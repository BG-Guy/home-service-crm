"use client";

import { Button } from "@/ui/components/Button";
import {
  DateField,
  Select,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import type { Draft } from "./TaskList";

/** Create / edit a task (lazy chunk behind TaskList's first tap). */
export default function TaskSheet({
  draft,
  setDraft,
  errors,
  pending,
  onSave,
  canAssign,
  users,
  viewerId,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  errors: Record<string, string[]>;
  pending: boolean;
  onSave: () => void;
  canAssign: boolean;
  users: { id: string; name: string }[];
  viewerId: string;
}) {
  return (
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
          onClick={onSave}
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
  );
}
