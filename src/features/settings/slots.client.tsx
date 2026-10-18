"use client";

import { Camera, Plus, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TagChip } from "@/ui/components/Chip";
import { DateField, Select, TextField } from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { getEntityTagsAction, setTagsAction } from "./actions";
import type {
  CustomFieldDef,
  CustomFieldsFieldsProps,
  TagBrief,
  TagEditorProps,
} from "./contracts";

// Client UI slots produced by B8 (BUILD_PLAN §5.1). They take serializable props and
// call only B8's own server actions. The tag picker sheet is lazy-loaded.

const TagPickerSheet = dynamic(() => import("./components/TagPickerSheet"), {
  ssr: false,
});

/**
 * S55 — Tag chips plus picker. Applying tags needs the entity's edit permission
 * (customer→customers.edit, job→jobs.edit, …); the action enforces it. Pass
 * `readOnly` to show chips only.
 */
export function TagEditor({
  entityType,
  entityId,
  initial,
  readOnly,
  className,
}: TagEditorProps & { readOnly?: boolean; className?: string }) {
  const [tags, setTags] = useState<TagBrief[]>(initial ?? []);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    getEntityTagsAction({ entityType, entityId }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setTags(r.data);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [entityType, entityId, initial]);

  function save(next: TagBrief[]) {
    const prev = tags;
    setTags(next);
    start(async () => {
      const r = await setTagsAction({
        entityType,
        entityId,
        tagIds: next.map((t) => t.id),
      });
      if (!r.ok) {
        setTags(prev);
        toast.error(r.error);
      }
    });
  }

  return (
    <div
      className={cx("flex flex-wrap items-center gap-1.5", className)}
      aria-busy={!loaded || undefined}
    >
      {tags.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          onRemove={
            readOnly ? undefined : () => save(tags.filter((x) => x.id !== t.id))
          }
        />
      ))}
      {tags.length === 0 && readOnly && (
        <span className="text-subhead text-label-3">No tags</span>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pressable hit-44 inline-flex h-6 items-center gap-1 rounded-pill bg-fill-2 px-2.5 text-footnote font-medium text-accent-text"
          aria-label="Edit tags"
        >
          <Plus aria-hidden size={14} strokeWidth={2.5} />
          {tags.length ? "Tag" : "Add tag"}
        </button>
      )}
      {open && (
        <TagPickerSheet
          entityType={entityType}
          selected={tags}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            setOpen(false);
            const same =
              next.length === tags.length &&
              next.every((n) => tags.some((t) => t.id === n.id));
            if (!same) save(next);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * S56 — Custom field inputs inside the consumer's `<form>`, named
 * `${namePrefix}.${key}` (multiselect: `${namePrefix}.${key}[]`). Validate on the
 * server with `validateCustomValues()`; pass its field errors back as `errors`.
 */
export function CustomFieldsFields({
  defs,
  values,
  namePrefix = "custom",
  jobId,
  errors,
  className,
}: CustomFieldsFieldsProps & {
  errors?: Record<string, string[]>;
  className?: string;
}) {
  if (!defs.length) return null;
  return (
    <div className={cx("flex flex-col gap-4", className)}>
      {defs.map((d) => (
        <CustomFieldInput
          key={d.key}
          def={d}
          name={`${namePrefix}.${d.key}`}
          value={values?.[d.key]}
          jobId={jobId}
          error={errors?.[`${namePrefix}.${d.key}`]?.[0]}
        />
      ))}
    </div>
  );
}

function CustomFieldInput({
  def,
  name,
  value,
  jobId,
  error,
}: {
  def: CustomFieldDef;
  name: string;
  value: unknown;
  jobId?: string;
  error?: string;
}) {
  const label = def.required ? `${def.label} *` : def.label;
  const str = value == null ? "" : String(value);
  switch (def.type) {
    case "text":
      return (
        <TextField
          label={label}
          name={name}
          defaultValue={str}
          required={def.required}
          maxLength={2000}
          error={error}
        />
      );
    case "number":
      return (
        <TextField
          label={label}
          name={name}
          type="number"
          inputMode="decimal"
          step="any"
          defaultValue={str}
          required={def.required}
          error={error}
        />
      );
    case "money":
      return (
        <MoneyField
          label={label}
          name={name}
          defaultCents={typeof value === "number" ? value : null}
          required={def.required}
          error={error}
        />
      );
    case "date":
      return (
        <DateField
          label={label}
          name={name}
          defaultValue={str}
          required={def.required}
          error={error}
        />
      );
    case "select":
      return (
        <Select
          label={label}
          name={name}
          defaultValue={str}
          required={def.required}
          placeholder="Choose…"
          options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
          error={error}
        />
      );
    case "multiselect":
      return (
        <MultiSelectField
          def={def}
          label={label}
          name={name}
          value={Array.isArray(value) ? value.map(String) : []}
          error={error}
        />
      );
    case "boolean":
      return (
        // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is inside the label
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-body">{def.label}</span>
          <Toggle
            name={name}
            value="true"
            defaultChecked={value === true}
            label={def.label}
          />
        </label>
      );
    case "photo":
      return (
        <PhotoField
          label={label}
          name={name}
          value={typeof value === "string" ? value : null}
          jobId={jobId}
          error={error}
        />
      );
    default:
      return null;
  }
}

function MultiSelectField({
  def,
  label,
  name,
  value,
  error,
}: {
  def: CustomFieldDef;
  label: string;
  name: string;
  value: string[];
  error?: string;
}) {
  const [sel, setSel] = useState<string[]>(value);
  const id = useId();
  return (
    <fieldset aria-describedby={error ? `${id}-e` : undefined}>
      <legend className="mb-1.5 text-subhead font-medium text-label-2">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {(def.options ?? []).map((o) => {
          const on = sel.includes(o);
          return (
            <label
              key={o}
              className={cx(
                "pressable inline-flex min-h-9 cursor-pointer items-center rounded-pill px-3 text-subhead",
                on
                  ? "bg-label text-[var(--card)]"
                  : "bg-card shadow-[0_0_0_0.5px_var(--sep)]",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                name={`${name}[]`}
                value={o}
                checked={on}
                onChange={() =>
                  setSel((s) => (on ? s.filter((x) => x !== o) : [...s, o]))
                }
              />
              {o}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-e`} className="mt-1 text-footnote text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function PhotoField({
  label,
  name,
  value,
  jobId,
  error,
}: {
  label: string;
  name: string;
  value: string | null;
  jobId?: string;
  error?: string;
}) {
  const [mediaId, setMediaId] = useState<string | null>(value);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  async function onFile(file: File) {
    setBusy(true);
    try {
      const [{ queueUpload }, { sha256Hex }] = await Promise.all([
        import("@/client/outbox"),
        import("@/client/image"),
      ]);
      const res = await queueUpload(file, {
        clientId: crypto.randomUUID(),
        kind: "photo",
        tag: "other",
        jobId: jobId ?? null,
        clientCapturedAt: new Date().toISOString(),
        fileLastModified: file.lastModified,
        sha256Original: await sha256Hex(file),
      });
      setPreview(URL.createObjectURL(file));
      if (res.mediaId) setMediaId(res.mediaId);
      else
        toast.warning("Photo saved offline", {
          message: "It uploads when you're back online; add it again then.",
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 text-subhead font-medium text-label-2">
        {label}
      </div>
      <input type="hidden" name={name} value={mediaId ?? ""} />
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) void onFile(f);
          e.currentTarget.value = "";
        }}
      />
      <div className="flex items-center gap-3">
        {(preview || mediaId) && (
          <div className="relative size-16 overflow-hidden rounded-control bg-fill-2">
            {preview ? (
              // biome-ignore lint/performance/noImgElement: local object URL preview
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <Camera
                aria-hidden
                className="absolute inset-0 m-auto text-label-3"
              />
            )}
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => {
                setMediaId(null);
                setPreview(null);
              }}
              className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X aria-hidden size={12} strokeWidth={3} />
            </button>
          </div>
        )}
        <Button
          variant="gray"
          size="sm"
          loading={busy}
          icon={<Camera aria-hidden size={16} />}
          onClick={() => input.current?.click()}
        >
          {mediaId ? "Replace" : "Add photo"}
        </Button>
      </div>
      {error && <p className="mt-1 text-footnote text-danger">{error}</p>}
    </div>
  );
}
