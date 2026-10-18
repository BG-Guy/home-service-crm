"use client";

import { Check } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TagChip } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { SkeletonList } from "@/ui/components/Skeleton";
import { toast } from "@/ui/components/Toast";
import { listTagOptionsAction, saveTagAction } from "../actions";
import type { TagBrief, TagTarget } from "../contracts";
import { TAG_COLORS, tagColorCss } from "../tag-colors";
import { ColorSwatches } from "./ColorSwatches";

/** Lazy tag picker for S55 TagEditor: multi-select, plus inline create for `tags.manage`. */
export default function TagPickerSheet({
  entityType,
  selected,
  onApply,
  onClose,
}: {
  entityType: TagTarget;
  selected: TagBrief[];
  onApply: (tags: TagBrief[]) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [options, setOptions] = useState<TagBrief[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(selected.map((t) => t.id)),
  );
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("blue");
  const [creating, start] = useTransition();

  useEffect(() => {
    listTagOptionsAction({ entityType }).then((r) => {
      if (r.ok && r.data) {
        setOptions(r.data.tags);
        setCanManage(r.data.canManage);
      } else {
        setOptions([]);
        if (!r.ok) toast.error(r.error);
      }
    });
  }, [entityType]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function apply() {
    const all = [...(options ?? []), ...selected];
    const byId = new Map(all.map((t) => [t.id, t]));
    onApply(
      [...picked].map((id) => byId.get(id)).filter(Boolean) as TagBrief[],
    );
    setOpen(false);
  }

  function create() {
    const n = name.trim();
    if (!n) return;
    start(async () => {
      const r = await saveTagAction({
        name: n,
        color,
        appliesTo: [entityType],
      });
      if (!r.ok || !r.data) {
        toast.error(r.ok ? "Couldn't create the tag." : r.error);
        return;
      }
      const t: TagBrief = {
        id: r.data.id,
        name: r.data.name,
        color: tagColorCss(r.data.color),
      };
      setOptions((o) => [...(o ?? []), t]);
      setPicked((s) => new Set(s).add(t.id));
      setName("");
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      title="Tags"
      detents={["medium", "large"]}
      leading={
        <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          onClick={apply}
        >
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {options === null ? (
          <SkeletonList rows={4} />
        ) : options.length === 0 ? (
          <div className="list-card">
            <EmptyState
              compact
              title="No tags yet"
              message={
                canManage
                  ? "Create the first one below."
                  : "Ask an admin to add tags in Settings → Tags."
              }
            />
          </div>
        ) : (
          <ListSection>
            {options.map((t) => (
              <ListRow
                key={t.id}
                leading={<TagChip name={t.name} color={t.color} />}
                title={<span className="sr-only">{t.name}</span>}
                accessory={
                  picked.has(t.id) ? (
                    <Check
                      aria-hidden
                      size={20}
                      strokeWidth={2.75}
                      className="text-accent-text"
                    />
                  ) : (
                    "none"
                  )
                }
                onClick={() => toggle(t.id)}
              />
            ))}
          </ListSection>
        )}

        {canManage && (
          <section aria-label="New tag" className="flex flex-col gap-3">
            <h2 className="px-4 text-footnote uppercase text-label-2">
              New tag
            </h2>
            <div className="flex flex-col gap-3 rounded-card bg-card p-4">
              <TextField
                label="Name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. Repeat customer"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create();
                  }
                }}
              />
              <ColorSwatches
                label="Color"
                value={color}
                onChange={setColor}
                options={TAG_COLORS.map((c) => ({
                  value: c,
                  css: tagColorCss(c),
                  name: c,
                }))}
              />
              <Button
                variant="tinted"
                onClick={create}
                loading={creating}
                disabled={!name.trim()}
              >
                Create and select
              </Button>
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
