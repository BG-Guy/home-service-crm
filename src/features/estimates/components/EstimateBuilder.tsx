"use client";

import { Ellipsis, PenLine, Plus, Send, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  type EditorLine,
  LineEditor,
} from "@/features/invoices/components/LineEditor";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { formatMoney } from "@/lib/money";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { DateField, TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  addEstimateOption,
  approveEstimateVerbal,
  declineEstimate,
  deleteEstimateLine,
  deleteEstimateOption,
  reopenEstimate,
  saveEstimateLine,
  sendEstimate,
  signEstimateInPerson,
  updateEstimateInfo,
  updateEstimateOption,
} from "../actions";
import { optionTotals } from "../logic";
import { DeclineSheet, SendDocSheet, VerbalApprovalSheet } from "./DocSheets";

// Estimate builder (SPEC M07): 1–3 options (Good/Better/Best, editable, one
// Recommended), lines from the price book or custom (add-ons, upsell, service-fee
// "credited if approved"), discounts within the role limit, details, then send,
// sign on this device (S15), approve on behalf (verbal) or decline.

export interface BuilderOption {
  id: string;
  label: string;
  recommended: boolean;
  notes: string | null;
  lines: (EditorLine & { id: string })[];
  deposit: {
    amountCents: number;
    ruleName: string;
    policyShort: string;
    capWarning: string | null;
  } | null;
}

export interface BuilderEstimate {
  id: string;
  number: string;
  status: string;
  title: string | null;
  notes: string | null;
  warrantyText: string | null;
  expiresOn: string | null;
  customerName: string;
  printHref: string;
}

type Res = { ok: true; data?: unknown } | { ok: false; error: string };

function report(r: Res, success?: string): boolean {
  if (r.ok) {
    if (success) toast({ title: success, tone: "success" });
  } else toast({ title: r.error, tone: "error" });
  return r.ok;
}

export function EstimateBuilder({
  estimate: e,
  options,
  taxBps,
  taxExempt,
  open,
  perms,
  consentText,
  coolingOff,
}: {
  estimate: BuilderEstimate;
  options: BuilderOption[];
  taxBps: number;
  taxExempt: boolean;
  /** draft / sent / viewed. */
  open: boolean;
  perms: {
    create: boolean;
    send: boolean;
    approveOnBehalf: boolean;
    discount: boolean;
    showCost: boolean;
  };
  consentText: string;
  coolingOff: boolean;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(
    options.find((o) => o.recommended)?.id ?? options[0]?.id ?? "",
  );
  const active = options.find((o) => o.id === activeId) ?? options[0];
  const [sheet, setSheet] = useState<
    | null
    | "send"
    | "more"
    | "option"
    | "details"
    | "sign"
    | "signpad"
    | "verbal"
    | "decline"
    | "add"
  >(null);
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const editable = open && perms.create;
  const anyLines = options.some((o) => o.lines.length > 0);

  // Selection used by "Sign on this device" and "Approve on behalf".
  const [pickOption, setPickOption] = useState(active?.id ?? "");
  const pick = options.find((o) => o.id === pickOption) ?? active;
  const [addons, setAddons] = useState<string[]>(() =>
    (pick?.lines ?? [])
      .filter((l) => l.isOptional && l.isSelected !== false)
      .map((l) => l.id),
  );
  const pickTotals = useMemo(
    () =>
      pick
        ? optionTotals(
            pick.lines.map((l) => ({
              id: l.id,
              type: l.type,
              totalCents: l.totalCents ?? 0,
              taxable: l.type === "discount" ? false : (l.taxable ?? false),
              isOptional: l.isOptional,
              isSelected: l.isSelected,
            })),
            taxBps,
            { taxExempt, selectedAddonIds: addons },
          )
        : null,
    [pick, taxBps, taxExempt, addons],
  );
  const choose = (id: string) => {
    setPickOption(id);
    const o = options.find((x) => x.id === id);
    setAddons(
      (o?.lines ?? [])
        .filter((l) => l.isOptional && l.isSelected !== false)
        .map((l) => l.id),
    );
  };

  const addOption = (copy: boolean) =>
    start(async () => {
      const r = await addEstimateOption({
        estimateId: e.id,
        copyFromOptionId: copy ? active?.id : undefined,
      });
      if (report(r, "Option added") && r.ok && r.data)
        setActiveId((r.data as { optionId: string }).optionId);
    });

  const more: ActionSheetItem[] = [
    ...(editable
      ? [{ label: "Edit details", onSelect: () => setSheet("details") }]
      : []),
    { label: "Print / PDF", href: e.printHref },
    ...(open && perms.approveOnBehalf && anyLines
      ? [
          {
            label: "Approve on behalf (verbal)",
            onSelect: () => {
              choose(active?.id ?? "");
              setSheet("verbal");
            },
          },
        ]
      : []),
    ...(open && perms.create
      ? [
          {
            label: "Mark declined",
            destructive: true,
            onSelect: () => setSheet("decline"),
          },
        ]
      : []),
    ...((e.status === "declined" || e.status === "expired") && perms.create
      ? [
          {
            label: "Reopen estimate",
            onSelect: () =>
              start(async () => {
                report(await reopenEstimate({ estimateId: e.id }), "Reopened");
              }),
          },
        ]
      : []),
  ];

  return (
    <>
      {confirmEl}
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {open && perms.send ? (
          <Button
            size="lg"
            icon={<Send size={18} aria-hidden />}
            className="flex-1"
            disabled={!anyLines}
            onClick={() => setSheet("send")}
          >
            {e.status === "draft" ? "Send" : "Resend"}
          </Button>
        ) : null}
        {open && perms.send ? (
          <Button
            size="lg"
            variant="tinted"
            icon={<PenLine size={18} aria-hidden />}
            className="flex-1"
            disabled={!anyLines}
            onClick={() => {
              choose(active?.id ?? "");
              setSheet("sign");
            }}
          >
            Sign here
          </Button>
        ) : null}
        <IconButton
          label="More actions"
          variant="gray"
          onClick={() => setSheet("more")}
        >
          <Ellipsis size={20} />
        </IconButton>
      </div>

      {/* Options */}
      <section aria-label="Options" className="space-y-3">
        <div className="flex items-center gap-2">
          {options.length > 1 ? (
            <SegmentedControl
              label="Options"
              className="flex-1"
              value={active?.id}
              onChange={setActiveId}
              segments={options.map((o) => ({
                value: o.id,
                label: (
                  <span className="truncate">
                    {o.label}
                    {o.recommended ? " ★" : ""}
                  </span>
                ),
              }))}
            />
          ) : (
            <p className="flex-1 px-1 text-headline">
              {active?.label ?? "Option"}
            </p>
          )}
          {editable ? (
            <>
              <IconButton
                label="Option settings"
                variant="gray"
                size={36}
                onClick={() => setSheet("option")}
              >
                <SlidersHorizontal size={18} />
              </IconButton>
              {options.length < 3 ? (
                <IconButton
                  label="Add option"
                  variant="gray"
                  size={36}
                  disabled={pending}
                  onClick={() =>
                    active && active.lines.length > 0
                      ? setSheet("add")
                      : addOption(false)
                  }
                >
                  <Plus size={18} />
                </IconButton>
              ) : null}
            </>
          ) : null}
        </div>
        {active?.recommended && options.length > 1 ? (
          <p className="px-1 text-footnote text-label-2">
            <Pill size="sm" dot={false} tone="green">
              Recommended
            </Pill>{" "}
            Customers see this option highlighted.
          </p>
        ) : null}
        {active ? (
          <LineEditor
            key={active.id}
            variant="estimate"
            header={`${active.label} items`}
            lines={active.lines}
            readOnly={!editable}
            taxBps={taxBps}
            taxExempt={taxExempt}
            allowDiscount={perms.discount}
            showCost={perms.showCost}
            emptyHint="Add services and parts from the price book. Mark extras as add-ons the customer can tick."
            onSave={async (line) =>
              report(
                await saveEstimateLine({
                  optionId: active.id,
                  line: { ...line, totalCents: undefined } as never,
                }),
                line.id ? "Line saved" : "Line added",
              )
            }
            onDelete={async (id) =>
              report(
                await deleteEstimateLine({ optionId: active.id, lineId: id }),
                "Line removed",
              )
            }
          />
        ) : null}
        {active?.deposit ? (
          <ListSection
            footer={
              active.deposit.capWarning ??
              `${active.deposit.policyShort} (${active.deposit.ruleName})`
            }
          >
            <ListRow
              title="Deposit when approved"
              detail={formatMoney(active.deposit.amountCents)}
            />
          </ListSection>
        ) : null}
      </section>

      {/* Sheets */}
      <ActionSheet
        open={sheet === "more"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={e.number}
        items={more}
      />
      {/* Adding an option asks whether to start from a copy (QA T2-19). */}
      <ActionSheet
        open={sheet === "add"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Add option"
        message="Start from a copy of this option's items, or from scratch."
        items={[
          {
            label: `Copy “${active?.label ?? "this option"}”`,
            onSelect: () => addOption(true),
          },
          { label: "Blank option", onSelect: () => addOption(false) },
        ]}
      />
      <SendDocSheet
        open={sheet === "send"}
        onClose={() => setSheet(null)}
        title={`Send ${e.number}`}
        blurb={`${e.customerName} gets a secure link to compare the options, sign and pay any deposit. Follow-ups go out automatically until they decide.`}
        send={async (channel) => {
          const r = await sendEstimate({ estimateId: e.id, channel });
          return r.ok
            ? {
                ok: true,
                data: r.data && { url: r.data.url, status: r.data.status },
              }
            : r;
        }}
      />
      {active && editable ? (
        <OptionSheet
          key={`opt-${active.id}-${active.label}-${active.recommended}`}
          open={sheet === "option"}
          onClose={() => setSheet(null)}
          option={active}
          canDelete={options.length > 1}
          canAdd={options.length < 3}
          onAddBlank={() => {
            setSheet(null);
            addOption(false);
          }}
          onDelete={async () => {
            // Confirm before starting the transition (QA T2-01).
            if (
              !(await confirm({
                title: `Delete “${active.label}”?`,
                message: "Its items are removed too.",
                confirmLabel: "Delete",
                destructive: true,
              }))
            )
              return;
            start(async () => {
              const ok = report(
                await deleteEstimateOption({ optionId: active.id }),
                "Option deleted",
              );
              if (ok) {
                setSheet(null);
                setActiveId(options.find((o) => o.id !== active.id)?.id ?? "");
              }
            });
          }}
        />
      ) : null}
      {editable ? (
        <DetailsSheet
          open={sheet === "details"}
          onClose={() => setSheet(null)}
          estimate={e}
        />
      ) : null}

      {/* Sign on this device: choose the option + add-ons, then sign (S15). */}
      <Sheet
        open={sheet === "sign"}
        onOpenChange={(o) => !o && setSheet(null)}
        title="Customer approval"
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setSheet(null)}>
            Cancel
          </Button>
        }
        footer={
          <div className="px-[var(--gutter)] pb-2 pt-2">
            <Button
              size="lg"
              fullWidth
              disabled={!pick || pick.lines.length === 0}
              onClick={() => setSheet("signpad")}
            >
              Continue to sign · {formatMoney(pickTotals?.totalCents ?? 0)}
            </Button>
          </div>
        }
      >
        <ChoosePanel
          options={options}
          pickId={pick?.id ?? ""}
          onPick={choose}
          addons={addons}
          setAddons={setAddons}
          totalCents={pickTotals?.totalCents ?? 0}
          coolingOff={coolingOff}
        />
      </Sheet>
      {pick ? (
        <SignatureSheet
          open={sheet === "signpad"}
          onOpenChange={(o) => !o && setSheet(null)}
          title={`Approve ${e.number}`}
          docType="estimate"
          consentText={consentText}
          summaryLines={[
            `${pick.label}: ${formatMoney(pickTotals?.totalCents ?? 0)}`,
            ...pick.lines
              .filter((l) => l.isOptional && addons.includes(l.id))
              .map((l) => `Add-on: ${l.name}`),
          ]}
          signerNameDefault={e.customerName}
          action={(s) =>
            signEstimateInPerson({
              ...s,
              estimateId: e.id,
              optionId: pick.id,
              addonIds: addons,
            })
          }
          onSigned={() => {
            setSheet(null);
            router.refresh();
          }}
        />
      ) : null}
      <VerbalApprovalSheet
        open={sheet === "verbal"}
        onClose={() => setSheet(null)}
        defaultName={e.customerName}
        summary={`${pick?.label ?? ""} · ${formatMoney(pickTotals?.totalCents ?? 0)}${addons.length ? ` · ${addons.length} add-on${addons.length === 1 ? "" : "s"}` : ""}. Switch the option on the builder first if needed.`}
        submit={async (v) => {
          const fd = new FormData();
          fd.set("estimateId", e.id);
          fd.set("optionId", pick?.id ?? "");
          for (const a of addons) fd.append("addonIds[]", a);
          fd.set("signerName", v.signerName);
          fd.set("note", v.note);
          const r = await approveEstimateVerbal(fd);
          return r.ok ? { ok: true } : r;
        }}
      />
      <DeclineSheet
        open={sheet === "decline"}
        onClose={() => setSheet(null)}
        title={`Decline ${e.number}`}
        submit={async (reason) => {
          const r = await declineEstimate({
            estimateId: e.id,
            reason: reason || null,
          });
          return r.ok ? { ok: true } : r;
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ choose panel */

export function ChoosePanel({
  options,
  pickId,
  onPick,
  addons,
  setAddons,
  totalCents,
  coolingOff,
}: {
  options: BuilderOption[];
  pickId: string;
  onPick: (id: string) => void;
  addons: string[];
  setAddons: (v: string[]) => void;
  totalCents: number;
  coolingOff: boolean;
}) {
  const pick = options.find((o) => o.id === pickId);
  const extras = (pick?.lines ?? []).filter((l) => l.isOptional);
  return (
    <div className="flex flex-col gap-5 px-[var(--gutter)] pb-6">
      <ListSection header="Option">
        {options.map((o) => (
          <ListRow
            key={o.id}
            title={
              <span className="flex items-center gap-2">
                {o.label}
                {o.recommended ? (
                  <Pill size="sm" dot={false} tone="green">
                    Recommended
                  </Pill>
                ) : null}
              </span>
            }
            subtitle={`${o.lines.filter((l) => !l.isOptional).length} items`}
            accessory={o.id === pickId ? "check" : "none"}
            onClick={() => onPick(o.id)}
          />
        ))}
      </ListSection>
      {extras.length > 0 ? (
        <ListSection header="Add-ons">
          {extras.map((l) => (
            <ToggleRow
              key={l.id}
              title={l.name}
              subtitle={formatMoney(l.totalCents ?? 0)}
              checked={addons.includes(l.id)}
              onChange={(ev) =>
                setAddons(
                  ev.currentTarget.checked
                    ? [...addons, l.id]
                    : addons.filter((a) => a !== l.id),
                )
              }
            />
          ))}
        </ListSection>
      ) : null}
      <div className="flex items-baseline justify-between rounded-card bg-card px-4 py-3 shadow-card">
        <span className="text-headline">Total</span>
        <span className="num text-title2 font-semibold">
          {formatMoney(totalCents)}
        </span>
      </div>
      {coolingOff ? (
        <p className="px-1 text-footnote text-label-2">
          The customer may cancel within 3 business days (FTC Cooling-Off Rule).
          The notice is attached to the signed estimate.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ option sheet */

function OptionSheet({
  open,
  onClose,
  option,
  canDelete,
  canAdd,
  onDelete,
  onAddBlank,
}: {
  open: boolean;
  onClose: () => void;
  option: BuilderOption;
  canDelete: boolean;
  canAdd: boolean;
  onDelete: () => void;
  onAddBlank: () => void;
}) {
  const [label, setLabel] = useState(option.label);
  const [recommended, setRecommended] = useState(option.recommended);
  const [notes, setNotes] = useState(option.notes ?? "");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const ok = report(
        await updateEstimateOption({
          optionId: option.id,
          label,
          recommended,
          notes: notes || null,
        }),
        "Option saved",
      );
      if (ok) onClose();
    });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Option"
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      trailing={
        <Button variant="plain" size="sm" loading={pending} onClick={save}>
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <TextField
          label="Label"
          value={label}
          maxLength={40}
          onChange={(ev) => setLabel(ev.currentTarget.value)}
        />
        <ListSection>
          <ToggleRow
            title="Recommended"
            checked={recommended}
            onChange={(ev) => setRecommended(ev.currentTarget.checked)}
          />
        </ListSection>
        <TextArea
          label="Notes for this option"
          value={notes}
          rows={3}
          onChange={(ev) => setNotes(ev.currentTarget.value)}
          placeholder="What makes this option different"
        />
        <div className="flex flex-wrap gap-2">
          {canAdd ? (
            <Button variant="gray" size="sm" onClick={onAddBlank}>
              Add a blank option
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              Delete option
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ details sheet */

function DetailsSheet({
  open,
  onClose,
  estimate: e,
}: {
  open: boolean;
  onClose: () => void;
  estimate: BuilderEstimate;
}) {
  const [title, setTitle] = useState(e.title ?? "");
  const [expiresOn, setExpiresOn] = useState(e.expiresOn ?? "");
  const [notes, setNotes] = useState(e.notes ?? "");
  const [warranty, setWarranty] = useState(e.warrantyText ?? "");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Details"
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const ok = report(
                await updateEstimateInfo({
                  estimateId: e.id,
                  title: title || null,
                  notes: notes || null,
                  warrantyText: warranty || null,
                  expiresOn: expiresOn || null,
                }),
                "Details saved",
              );
              if (ok) onClose();
            })
          }
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <TextField
          label="Title"
          value={title}
          maxLength={200}
          onChange={(ev) => setTitle(ev.currentTarget.value)}
        />
        <DateField
          label="Expires"
          value={expiresOn}
          onChange={(ev) => setExpiresOn(ev.currentTarget.value)}
        />
        <TextArea
          label="Notes to the customer"
          value={notes}
          rows={4}
          onChange={(ev) => setNotes(ev.currentTarget.value)}
        />
        <TextArea
          label="Warranty"
          value={warranty}
          rows={3}
          onChange={(ev) => setWarranty(ev.currentTarget.value)}
          placeholder="e.g. 1-year parts and labor"
        />
      </div>
    </Sheet>
  );
}
