"use client";

import dynamic from "next/dynamic";
import type { useRouter } from "next/navigation";
import type { TransitionStartFunction } from "react";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import type { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { DateField, TextArea, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import {
  approveEstimateVerbal,
  declineEstimate,
  deleteEstimateOption,
  sendEstimate,
  signEstimateInPerson,
  updateEstimateInfo,
  updateEstimateOption,
} from "../actions";
import { DeclineSheet, SendDocSheet, VerbalApprovalSheet } from "./DocSheets";
import type {
  BuilderEstimate,
  BuilderOption,
  BuilderSheet,
} from "./EstimateBuilder";

// The estimate builder's overlays (more, add option, send, option settings,
// details, sign here, verbal approval, decline): a lazy chunk fetched on
// hover/focus or the first tap. The one-step signature is its own chunk.

const SignatureApproval = dynamic(
  () => import("@/features/signatures/approval.client"),
  { ssr: false },
);

type Res = { ok: true; data?: unknown } | { ok: false; error: string };

function report(r: Res, success?: string): boolean {
  if (r.ok) {
    if (success) toast({ title: success, tone: "success" });
  } else toast({ title: r.error, tone: "error" });
  return r.ok;
}

export interface BuilderSheetsProps {
  e: BuilderEstimate;
  options: BuilderOption[];
  active: BuilderOption | undefined;
  editable: boolean;
  more: ActionSheetItem[];
  sheet: BuilderSheet;
  setSheet: (s: BuilderSheet) => void;
  addOption: (copy: boolean) => void;
  pick: BuilderOption | undefined;
  pickTotals: { totalCents: number } | null;
  choose: (id: string) => void;
  addons: string[];
  setAddons: (v: string[]) => void;
  coolingOff: boolean;
  consentText: string;
  confirm: ReturnType<typeof useConfirm>[0];
  start: TransitionStartFunction;
  setActiveId: (id: string) => void;
  router: ReturnType<typeof useRouter>;
}

export default function EstimateBuilderSheets({
  e,
  options,
  active,
  editable,
  more,
  sheet,
  setSheet,
  addOption,
  pick,
  pickTotals,
  choose: _choose,
  addons,
  setAddons,
  coolingOff,
  consentText,
  confirm,
  start,
  setActiveId,
  router,
}: BuilderSheetsProps) {
  // The signature screen mounts on first use and stays (its close animation).
  const [signArmed, setSignArmed] = useState(false);
  if (sheet === "sign" && !signArmed) setSignArmed(true);
  return (
    <>
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

      {/* Sign here: straight to the one-step landscape signature (E4): the
          selected option, its add-ons, the consent, the name and the pad. */}
      {pick && signArmed ? (
        <SignatureApproval
          open={sheet === "sign"}
          onOpenChange={(o) => !o && setSheet(null)}
          title={
            options.length > 1
              ? `Sign to approve ${pick.label}`
              : `Sign to approve ${e.number}`
          }
          totalLabel={formatMoney(pickTotals?.totalCents ?? 0)}
          docType="estimate"
          consentText={consentText}
          signerNameDefault={e.customerName}
          summary={
            <SignSummary
              option={pick}
              multi={options.length > 1}
              totalCents={pickTotals?.totalCents ?? 0}
              addons={addons}
              setAddons={setAddons}
              coolingOff={coolingOff}
            />
          }
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

/* ------------------------------------------------------------------ sign summary */

/** Beside the pad when the tech hands the phone over: the option and its add-ons. */
function SignSummary({
  option,
  multi,
  totalCents,
  addons,
  setAddons,
  coolingOff,
}: {
  option: BuilderOption;
  multi: boolean;
  totalCents: number;
  addons: string[];
  setAddons: (v: string[]) => void;
  coolingOff: boolean;
}) {
  const extras = option.lines.filter((l) => l.isOptional);
  const items = option.lines.length - extras.length;
  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-footnote text-label-2">
        <span className="font-semibold text-label">
          {multi ? option.label : "Total"} · {formatMoney(totalCents)}
        </span>
        {` · ${items} ${items === 1 ? "item" : "items"}`}
      </p>
      {extras.length > 0 ? (
        <div className="list-card">
          {extras.map((l) => (
            <ToggleRow
              key={l.id}
              title={l.name}
              subtitle={`Add-on · +${formatMoney(l.totalCents ?? 0)}`}
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
        </div>
      ) : null}
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
