"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Plus,
  TextCursorInput,
} from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import {
  moveCustomFieldAction,
  saveCustomFieldAction,
  setCustomFieldActiveAction,
} from "../actions";
import type { CustomFieldDef } from "../contracts";
import { fieldKeyFromLabel } from "../custom-values";
import { ENTITY_LABELS, FIELD_TYPE_LABELS } from "../options";
import { CustomFieldsFields } from "../slots.client";
import {
  FArea,
  FieldCard,
  FormErrors,
  FSelect,
  FText,
  useActionForm,
} from "./form";

export interface CustomFieldItem {
  id: string;
  entityType: string;
  key: string;
  label: string;
  type: CustomFieldDef["type"];
  options: string[];
  required: boolean;
  showOnInvoice: boolean;
  active: boolean;
  serviceTypeIds: string[];
}

export function CustomFieldsManager({
  entity,
  fields,
  serviceTypes,
}: {
  entity: string;
  fields: CustomFieldItem[];
  serviceTypes: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<CustomFieldItem | "new" | null>(null);
  const [, start] = useTransition();
  const active = fields.filter((f) => f.active);
  const archived = fields.filter((f) => !f.active);
  const label = ENTITY_LABELS[entity] ?? entity;

  const run = (p: Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await p;
      if (!r.ok) toast.error(r.error ?? "Something went wrong.");
      else if (ok) toast.success(ok);
    });

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {active.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<TextCursorInput size={40} strokeWidth={1.6} />}
            title={`No custom fields on ${label.toLowerCase()}`}
            message="Capture what your trade needs: lock brand, door model, filter size, gate code…"
            action={
              <Button onClick={() => setEditing("new")}>Add a field</Button>
            }
          />
        </div>
      ) : (
        <ListSection
          header={`${label} fields`}
          trailing={
            <Button
              variant="plain"
              size="sm"
              icon={<Plus aria-hidden size={16} />}
              onClick={() => setEditing("new")}
            >
              Add
            </Button>
          }
          footer="Fields show on the form in this order. Swipe left to archive (values are kept)."
        >
          {active.map((f, i) => (
            <SwipeActions
              key={f.id}
              trailing={[
                {
                  label: "Archive",
                  tone: "orange",
                  icon: <Archive aria-hidden size={18} />,
                  onAction: () =>
                    run(
                      setCustomFieldActiveAction({ id: f.id, active: false }),
                      `${f.label} archived`,
                    ),
                },
              ]}
            >
              <div className="flex items-center">
                <div className="min-w-0 flex-1">
                  <ListRow
                    title={f.label}
                    subtitle={[
                      FIELD_TYPE_LABELS[f.type],
                      f.required ? "Required" : null,
                      f.showOnInvoice ? "On invoice" : null,
                      f.serviceTypeIds.length
                        ? `${f.serviceTypeIds.length} service type${f.serviceTypeIds.length === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onClick={() => setEditing(f)}
                    accessory="chevron"
                  />
                </div>
                <div className="flex shrink-0 flex-col pr-2">
                  <button
                    type="button"
                    aria-label={`Move ${f.label} up`}
                    disabled={i === 0}
                    onClick={() =>
                      run(moveCustomFieldAction({ id: f.id, direction: "up" }))
                    }
                    className="flex h-6 w-11 items-center justify-center text-label-2 disabled:opacity-25"
                  >
                    <ChevronUp aria-hidden size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${f.label} down`}
                    disabled={i === active.length - 1}
                    onClick={() =>
                      run(
                        moveCustomFieldAction({ id: f.id, direction: "down" }),
                      )
                    }
                    className="flex h-6 w-11 items-center justify-center text-label-2 disabled:opacity-25"
                  >
                    <ChevronDown aria-hidden size={18} />
                  </button>
                </div>
              </div>
            </SwipeActions>
          ))}
        </ListSection>
      )}

      {archived.length > 0 && (
        <ListSection header="Archived">
          {archived.map((f) => (
            <SwipeActions
              key={f.id}
              trailing={[
                {
                  label: "Restore",
                  tone: "green",
                  icon: <ArchiveRestore aria-hidden size={18} />,
                  onAction: () =>
                    run(
                      setCustomFieldActiveAction({ id: f.id, active: true }),
                      `${f.label} restored`,
                    ),
                },
              ]}
            >
              <ListRow
                title={<span className="text-label-2">{f.label}</span>}
                detail={FIELD_TYPE_LABELS[f.type]}
                onClick={() => setEditing(f)}
              />
            </SwipeActions>
          ))}
        </ListSection>
      )}

      {active.length > 0 && (
        <section aria-label="Preview">
          <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
            Preview
          </h2>
          <div className="rounded-card bg-card p-4">
            <form onSubmit={(e) => e.preventDefault()} aria-hidden>
              <CustomFieldsFields
                defs={active.map((f) => ({
                  key: f.key,
                  label: f.label,
                  type: f.type,
                  options: f.options,
                  required: f.required,
                  showOnInvoice: f.showOnInvoice,
                }))}
                values={{}}
                namePrefix="preview"
              />
            </form>
          </div>
        </section>
      )}

      {editing && (
        <CustomFieldSheet
          entity={entity}
          field={editing === "new" ? null : editing}
          serviceTypes={serviceTypes}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CustomFieldSheet({
  entity,
  field,
  serviceTypes,
  onClose,
}: {
  entity: string;
  field: CustomFieldItem | null;
  serviceTypes: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [type, setType] = useState<CustomFieldDef["type"]>(
    field?.type ?? "text",
  );
  const [label, setLabel] = useState(field?.label ?? "");
  const [scope, setScope] = useState<string[]>(field?.serviceTypeIds ?? []);
  const f = useActionForm(saveCustomFieldAction, {
    success: field ? "Field saved" : "Field added",
    onSuccess: () => setOpen(false),
  });
  const hasOptions = type === "select" || type === "multiselect";
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      title={field ? field.label : "New field"}
      detents={["large"]}
      dirty={label !== (field?.label ?? "")}
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
          {field && <input type="hidden" name="id" value={field.id} />}
          <input type="hidden" name="entityType" value={entity} />
          <FieldCard>
            <FText
              name="label"
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.currentTarget.value)}
              placeholder="Lock brand"
              required
              autoFocus={!field}
              maxLength={60}
            />
            {field ? (
              <p className="text-footnote text-label-2">
                Key <code className="font-mono">{field.key}</code> (used by
                imports, templates and the API; it can't change).
              </p>
            ) : (
              <FText
                name="key"
                label="Key"
                defaultValue=""
                placeholder={fieldKeyFromLabel(label || "Lock brand")}
                hint="Optional. Lowercase, used by imports and templates."
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
            <FSelect
              name="type"
              label="Type"
              value={type}
              onChange={(e) =>
                setType(e.currentTarget.value as CustomFieldDef["type"])
              }
              disabled={!!field && field.active}
              options={Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => ({
                value: v,
                label: l,
              }))}
              hint={
                field?.active
                  ? "Archive and re-add the field to change its type."
                  : undefined
              }
            />
            {field?.active && <input type="hidden" name="type" value={type} />}
            {hasOptions && (
              <FArea
                name="options"
                label="Options (one per line)"
                defaultValue={field?.options.join("\n")}
                rows={5}
                placeholder={"Schlage\nKwikset\nMedeco"}
              />
            )}
          </FieldCard>
          <section>
            <div className="rounded-card bg-card">
              <ToggleRow
                title="Required"
                name="required"
                defaultChecked={field?.required ?? false}
              />
              <ToggleRow
                title="Show on invoice"
                name="showOnInvoice"
                defaultChecked={field?.showOnInvoice ?? false}
              />
              <ToggleRow
                title="Active"
                name="active"
                defaultChecked={field?.active ?? true}
              />
            </div>
          </section>
          {entity === "job" && serviceTypes.length > 0 && (
            <section>
              <h2 className="px-4 pb-2 text-subhead font-semibold text-label-2">
                Only for these service types
              </h2>
              <div className="flex flex-wrap gap-1.5 rounded-card bg-card p-4">
                {serviceTypes.map((s) => {
                  const on = scope.includes(s.id);
                  return (
                    <label
                      key={s.id}
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
                        name="serviceTypeIds[]"
                        value={s.id}
                        checked={on}
                        onChange={() =>
                          setScope((x) =>
                            on ? x.filter((y) => y !== s.id) : [...x, s.id],
                          )
                        }
                      />
                      {s.name}
                    </label>
                  );
                })}
              </div>
              <p className="px-4 pt-1.5 text-footnote text-label-2">
                {scope.length ? (
                  <>
                    Shown on{" "}
                    <Pill size="sm" tone="blue">
                      {scope.length}
                    </Pill>{" "}
                    service type{scope.length === 1 ? "" : "s"} only.
                  </>
                ) : (
                  "None selected: shown on every job."
                )}
              </p>
            </section>
          )}
        </form>
      </FormErrors>
    </Sheet>
  );
}
