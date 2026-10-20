"use client";

import { Plus, Tag, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { TagChip } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { deleteTagAction, saveTagAction } from "../actions";
import { ENTITY_LABELS } from "../options";
import { TAG_COLORS, tagColorCss } from "../tag-colors";
import { ColorSwatches } from "./ColorSwatches";
import {
  FieldCard,
  FieldErrorText,
  FormErrors,
  FText,
  useActionForm,
} from "./form";

const TARGETS = [
  "customer",
  "job",
  "lead",
  "estimate",
  "invoice",
  "vehicle",
  "tool",
] as const;

export interface TagItem {
  id: string;
  name: string;
  color: string;
  appliesTo: string[];
  uses: number;
}

export function TagsManager({ tags }: { tags: TagItem[] }) {
  const [editing, setEditing] = useState<TagItem | "new" | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const [, start] = useTransition();

  async function remove(t: TagItem) {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      message:
        t.uses > 0
          ? `It's on ${t.uses} record${t.uses === 1 ? "" : "s"}; it will be removed from all of them.`
          : "This can't be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await deleteTagAction({ id: t.id });
      if (r.ok) toast.success(`Deleted “${t.name}”`);
      else toast.error(r.error);
    });
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {confirmEl}
      {tags.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<Tag size={40} strokeWidth={1.6} />}
            title="No tags yet"
            message="Tags label customers, jobs and more: VIP, Warranty, Commercial…"
            action={<Button onClick={() => setEditing("new")}>New tag</Button>}
          />
        </div>
      ) : (
        <ListSection
          header={`${tags.length} tag${tags.length === 1 ? "" : "s"}`}
          trailing={
            <Button
              variant="plain"
              size="sm"
              icon={<Plus aria-hidden size={16} />}
              onClick={() => setEditing("new")}
            >
              New tag
            </Button>
          }
          footer="Anyone who can edit a record can apply its tags. Swipe left to delete."
        >
          {tags.map((t) => (
            <SwipeActions
              key={t.id}
              trailing={[
                {
                  label: "Delete",
                  destructive: true,
                  icon: <Trash2 aria-hidden size={18} />,
                  onAction: () => void remove(t),
                },
              ]}
            >
              <ListRow
                leading={<TagChip name={t.name} color={tagColorCss(t.color)} />}
                title={<span className="sr-only">{t.name}</span>}
                subtitle={t.appliesTo
                  .map((a) => ENTITY_LABELS[a] ?? a)
                  .join(", ")}
                detail={
                  t.uses ? `${t.uses} use${t.uses === 1 ? "" : "s"}` : "Unused"
                }
                accessory="chevron"
                onClick={() => setEditing(t)}
                multiline
              />
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {editing && (
        <TagSheet
          tag={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TagSheet({
  tag,
  onClose,
}: {
  tag: TagItem | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "blue");
  const [targets, setTargets] = useState<string[]>(
    tag?.appliesTo ?? ["customer", "job"],
  );
  const f = useActionForm(saveTagAction, {
    success: tag ? "Tag saved" : "Tag created",
    onSuccess: () => setOpen(false),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      title={tag ? "Edit tag" : "New tag"}
      detents={["large"]}
      dirty={name !== (tag?.name ?? "")}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          type="submit"
          form={f.id}
          loading={f.pending}
          className="font-semibold"
        >
          Save
        </Button>
      }
    >
      <FormErrors errors={f.errors}>
        <form {...f.formProps} className="flex flex-col gap-6">
          {tag && <input type="hidden" name="id" value={tag.id} />}
          <div className="flex justify-center py-2">
            <TagChip
              name={name.trim() || "Tag name"}
              color={tagColorCss(color)}
            />
          </div>
          <FieldCard>
            <FText
              name="name"
              label="Name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={40}
              required
              autoFocus={!tag}
            />
            <ColorSwatches
              label="Color"
              name="color"
              value={color}
              onChange={setColor}
              options={TAG_COLORS.map((c) => ({
                value: c,
                css: tagColorCss(c),
                name: c,
              }))}
            />
          </FieldCard>
          <section>
            <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
              Use on
            </h2>
            <div className="flex flex-wrap gap-1.5 rounded-card bg-card p-4">
              {TARGETS.map((t) => {
                const on = targets.includes(t);
                return (
                  <label
                    key={t}
                    className={cx(
                      "pressable inline-flex min-h-9 cursor-pointer items-center rounded-pill px-3.5 text-subhead font-medium",
                      on
                        ? "bg-label text-[var(--card)]"
                        : "bg-fill-2 text-label",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      name="appliesTo[]"
                      value={t}
                      checked={on}
                      onChange={() =>
                        setTargets((s) =>
                          on ? s.filter((x) => x !== t) : [...s, t],
                        )
                      }
                    />
                    {ENTITY_LABELS[t]}
                  </label>
                );
              })}
            </div>
            <FieldErrorText name="appliesTo" className="px-4 pt-1.5" />
            {tag?.appliesTo.some((a) => !targets.includes(a)) &&
              tag.uses > 0 && (
                <p className="px-4 pt-1.5 text-footnote text-[var(--sys-orange)]">
                  Removing a record type also removes this tag from those
                  records.
                </p>
              )}
          </section>
        </form>
      </FormErrors>
    </Sheet>
  );
}
