"use client";

import {
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Plus,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { deleteChecklistAction, saveChecklistAction } from "../actions";
import type { ChecklistItemDef } from "../contracts";
import { CHECKLIST_ITEM_TYPES } from "../options";

export interface ChecklistItem {
  id: string;
  name: string;
  items: ChecklistItemDef[];
  usedBy: { id: string; name: string }[];
}

const TYPE_LABEL = Object.fromEntries(
  CHECKLIST_ITEM_TYPES.map((t) => [t.value, t.label]),
) as Record<string, string>;

export function ChecklistsManager({ lists }: { lists: ChecklistItem[] }) {
  const [editing, setEditing] = useState<ChecklistItem | "new" | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const [, start] = useTransition();

  async function remove(c: ChecklistItem) {
    if (
      !(await confirm({
        title: `Delete “${c.name}”?`,
        message: "Jobs that already copied it keep their answers.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    start(async () => {
      const r = await deleteChecklistAction({ id: c.id });
      if (r.ok) toast.success("Checklist deleted");
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {confirmEl}
      {lists.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<ClipboardCheck size={40} strokeWidth={1.6} />}
            title="No checklists yet"
            message="Checklists make sure every job is done the same way: photos, tests, signatures."
            action={
              <Button onClick={() => setEditing("new")}>New checklist</Button>
            }
          />
        </div>
      ) : (
        <ListSection
          header="Templates"
          trailing={
            <Button
              variant="plain"
              size="sm"
              icon={<Plus aria-hidden size={16} />}
              onClick={() => setEditing("new")}
            >
              New
            </Button>
          }
          footer="Attach a checklist to a job type in Settings → Job types."
        >
          {lists.map((c) => (
            <SwipeActions
              key={c.id}
              trailing={[
                {
                  label: "Delete",
                  destructive: true,
                  icon: <Trash2 aria-hidden size={18} />,
                  onAction: () => void remove(c),
                },
              ]}
            >
              <ListRow
                title={c.name}
                subtitle={
                  c.usedBy.length
                    ? `Used by ${c.usedBy.map((u) => u.name).join(", ")}`
                    : "Not attached to a service type"
                }
                detail={`${c.items.length} item${c.items.length === 1 ? "" : "s"}`}
                accessory="chevron"
                onClick={() => setEditing(c)}
              />
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {editing && (
        <ChecklistSheet
          list={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

type Draft = ChecklistItemDef & { optionsText: string };

const newItem = (): Draft => ({
  id: crypto.randomUUID().slice(0, 8),
  label: "",
  type: "check",
  required: true,
  optionsText: "",
});

function ChecklistSheet({
  list,
  onClose,
}: {
  list: ChecklistItem | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(list?.name ?? "");
  const [items, setItems] = useState<Draft[]>(
    list?.items.length
      ? list.items.map((i) => ({
          ...i,
          optionsText: (i.options ?? []).join("\n"),
        }))
      : [newItem()],
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Draft>) => {
    setDirty(true);
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const move = (i: number, d: -1 | 1) => {
    setDirty(true);
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const n = [...xs];
      [n[i], n[j]] = [n[j] as Draft, n[i] as Draft];
      return n;
    });
  };

  function save() {
    start(async () => {
      const r = await saveChecklistAction({
        id: list?.id,
        name,
        items: items.map(({ optionsText, ...it }) => ({
          ...it,
          options:
            it.type === "select"
              ? optionsText
                  .split("\n")
                  .map((o) => o.trim())
                  .filter(Boolean)
              : undefined,
        })),
      });
      if (r.ok) {
        toast.success(list ? "Checklist saved" : "Checklist created");
        setDirty(false);
        setOpen(false);
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  }

  const err = (k: string) => errors[k]?.[0];

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      dirty={dirty}
      title={list ? list.name : "New checklist"}
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
          className="font-semibold"
          onClick={save}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="rounded-card bg-card p-4">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setDirty(true);
            }}
            placeholder="Standard repair"
            error={err("name")}
            autoFocus={!list}
          />
        </div>
        <section aria-label="Items">
          <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
            Items
          </h2>
          <ol className="flex flex-col gap-3">
            {items.map((it, i) => (
              <li key={it.id} className="rounded-card bg-card p-4">
                <div className="flex items-start gap-2">
                  <span className="num mt-9 w-5 shrink-0 text-center text-subhead text-label-2">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <TextField
                      label="Label"
                      value={it.label}
                      onChange={(e) =>
                        update(i, { label: e.currentTarget.value })
                      }
                      placeholder="Photo of finished work"
                      error={err(`items.${i}.label`)}
                    />
                    <div className="flex items-end gap-3">
                      <Select
                        label="Type"
                        value={it.type}
                        className="flex-1"
                        onChange={(e) =>
                          update(i, {
                            type: e.currentTarget.value as Draft["type"],
                          })
                        }
                        options={CHECKLIST_ITEM_TYPES}
                      />
                      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label */}
                      <label className="flex min-h-11 items-center gap-2 pb-0.5">
                        <span className="text-subhead text-label-2">
                          Required
                        </span>
                        <Toggle
                          checked={it.required}
                          onChange={(e) =>
                            update(i, { required: e.currentTarget.checked })
                          }
                          label={`Item ${i + 1} required`}
                        />
                      </label>
                    </div>
                    {it.type === "select" && (
                      <TextArea
                        label="Options (one per line)"
                        value={it.optionsText}
                        rows={3}
                        onChange={(e) =>
                          update(i, { optionsText: e.currentTarget.value })
                        }
                        error={err(`items.${i}.options`)}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-center">
                    <button
                      type="button"
                      aria-label={`Move item ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="flex size-11 items-center justify-center text-label-2 disabled:opacity-25"
                    >
                      <ChevronUp aria-hidden size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move item ${i + 1} down`}
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                      className="flex size-11 items-center justify-center text-label-2 disabled:opacity-25"
                    >
                      <ChevronDown aria-hidden size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove item ${i + 1}`}
                      disabled={items.length === 1}
                      onClick={() => {
                        setDirty(true);
                        setItems((xs) => xs.filter((_, j) => j !== i));
                      }}
                      className="flex size-11 items-center justify-center text-danger disabled:opacity-25"
                    >
                      <Trash2 aria-hidden size={18} />
                    </button>
                  </div>
                </div>
                <p className="sr-only">{TYPE_LABEL[it.type]}</p>
              </li>
            ))}
          </ol>
          {err("items") && (
            <p className="px-4 pt-1.5 text-footnote text-danger">
              {err("items")}
            </p>
          )}
          <Button
            variant="tinted"
            className="mt-3"
            fullWidth
            icon={<Plus aria-hidden size={18} />}
            onClick={() => {
              setDirty(true);
              setItems((xs) => [...xs, newItem()]);
            }}
          >
            Add item
          </Button>
        </section>
      </div>
    </Sheet>
  );
}
