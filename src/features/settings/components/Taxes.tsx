"use client";

import { Archive, ArchiveRestore, Plus, Star } from "lucide-react";
import { useState, useTransition } from "react";
import { formatBps } from "@/lib/money";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  saveTaxRateAction,
  setDefaultTaxRateAction,
  setTaxRateActiveAction,
  updateTaxDefaultsAction,
} from "../actions";
import {
  FieldCard,
  FormErrors,
  FSelect,
  FText,
  StickySave,
  useActionForm,
} from "./form";

export interface TaxRateItem {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
  active: boolean;
}

export function TaxRates({ rates }: { rates: TaxRateItem[] }) {
  const [editing, setEditing] = useState<TaxRateItem | "new" | null>(null);
  const [, start] = useTransition();
  const run = (p: Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await p;
      if (r.ok) toast.success(done);
      else toast.error(r.error ?? "Something went wrong.");
    });
  const active = rates.filter((r) => r.active);
  const archived = rates.filter((r) => !r.active);
  return (
    <>
      <ListSection
        header="Tax rates"
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
        footer="The default rate applies to taxable lines unless a service type or tax-exempt customer says otherwise. Swipe for more."
      >
        {active.map((r) => (
          <SwipeActions
            key={r.id}
            leading={
              r.isDefault
                ? []
                : [
                    {
                      label: "Default",
                      icon: <Star aria-hidden size={18} />,
                      tone: "blue",
                      onAction: () =>
                        run(
                          setDefaultTaxRateAction({ id: r.id }),
                          `${r.name} is the default`,
                        ),
                    },
                  ]
            }
            trailing={
              r.isDefault
                ? []
                : [
                    {
                      label: "Archive",
                      icon: <Archive aria-hidden size={18} />,
                      tone: "orange",
                      onAction: () =>
                        run(
                          setTaxRateActiveAction({ id: r.id, active: false }),
                          `${r.name} archived`,
                        ),
                    },
                  ]
            }
          >
            <ListRow
              title={r.name}
              subtitle={
                r.rateBps === 0
                  ? "Set the real rate before invoicing"
                  : undefined
              }
              detail={
                <span className="flex items-center gap-2">
                  {r.isDefault && (
                    <Pill tone="blue" size="sm">
                      Default
                    </Pill>
                  )}
                  {formatBps(r.rateBps)}
                </span>
              }
              accessory="chevron"
              onClick={() => setEditing(r)}
            />
          </SwipeActions>
        ))}
      </ListSection>
      {archived.length > 0 && (
        <ListSection header="Archived">
          {archived.map((r) => (
            <SwipeActions
              key={r.id}
              trailing={[
                {
                  label: "Restore",
                  icon: <ArchiveRestore aria-hidden size={18} />,
                  tone: "green",
                  onAction: () =>
                    run(
                      setTaxRateActiveAction({ id: r.id, active: true }),
                      `${r.name} restored`,
                    ),
                },
              ]}
            >
              <ListRow
                title={<span className="text-label-2">{r.name}</span>}
                detail={formatBps(r.rateBps)}
              />
            </SwipeActions>
          ))}
        </ListSection>
      )}
      {editing && (
        <TaxRateSheet
          rate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function TaxRateSheet({
  rate,
  onClose,
}: {
  rate: TaxRateItem | null;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const f = useActionForm(saveTaxRateAction, {
    success: rate ? "Tax rate saved" : "Tax rate added",
    onSuccess: () => setOpen(false),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      onClosed={onClose}
      title={rate ? "Edit tax rate" : "New tax rate"}
      detents={["content"]}
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
        <form {...f.formProps} className="flex flex-col gap-6 pb-4">
          {rate && <input type="hidden" name="id" value={rate.id} />}
          <FieldCard>
            <FText
              name="name"
              label="Name"
              defaultValue={rate?.name}
              placeholder="Austin sales tax"
              required
              autoFocus
            />
            <FText
              name="ratePercent"
              label="Rate"
              type="number"
              inputMode="decimal"
              step="0.001"
              min={0}
              max={30}
              defaultValue={rate ? String(rate.rateBps / 100) : ""}
              placeholder="8.25"
              trailing={<span className="text-label-2">%</span>}
              required
            />
          </FieldCard>
          {!rate?.isDefault && (
            <div className="rounded-card bg-card">
              <ToggleRow title="Make default" name="isDefault" />
            </div>
          )}
        </form>
      </FormErrors>
    </Sheet>
  );
}

export function TaxDefaults({
  initial,
  serviceTypes,
  rates,
}: {
  initial: {
    laborTaxable: boolean;
    partsTaxable: boolean;
    feesTaxable: boolean;
    byServiceType: Record<string, string | null>;
  };
  serviceTypes: { id: string; name: string }[];
  rates: TaxRateItem[];
}) {
  const f = useActionForm(updateTaxDefaultsAction, {
    success: "Tax defaults saved",
  });
  const options = rates
    .filter((r) => r.active)
    .map((r) => ({
      value: r.id,
      label: `${r.name} (${formatBps(r.rateBps)})`,
    }));
  return (
    <FormErrors errors={f.errors}>
      <form {...f.formProps} className="flex flex-col gap-[var(--section-gap)]">
        <ListSection
          header="Taxable by default"
          footer="New lines start with these settings; you can change any line. Tax-exempt customers are never taxed."
        >
          <ToggleRow
            title="Labor and services"
            name="laborTaxable"
            defaultChecked={initial.laborTaxable}
          />
          <ToggleRow
            title="Parts and materials"
            name="partsTaxable"
            defaultChecked={initial.partsTaxable}
          />
          <ToggleRow
            title="Fees"
            name="feesTaxable"
            defaultChecked={initial.feesTaxable}
          />
        </ListSection>
        {serviceTypes.length > 0 && (
          <FieldCard
            header="Rate by service type"
            footer="Leave on Default unless a service is taxed differently."
          >
            {serviceTypes.map((s) => (
              <FSelect
                key={s.id}
                name={`byServiceType.${s.id}`}
                label={s.name}
                layout="row"
                defaultValue={initial.byServiceType[s.id] ?? ""}
                placeholder="Default rate"
                options={options}
              />
            ))}
          </FieldCard>
        )}
        <StickySave pending={f.pending} label="Save defaults" />
      </form>
    </FormErrors>
  );
}
