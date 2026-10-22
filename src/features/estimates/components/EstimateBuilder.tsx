"use client";

import { Ellipsis, PenLine, Plus, Send, SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  type EditorLine,
  LineEditor,
} from "@/features/invoices/components/LineEditor";
import { formatMoney } from "@/lib/money";
import type { ActionSheetItem } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Pill } from "@/ui/components/StatusPill";
import { toast } from "@/ui/components/Toast";
import {
  addEstimateOption,
  deleteEstimateLine,
  reopenEstimate,
  saveEstimateLine,
} from "../actions";
import { optionTotals } from "../logic";
import { PresentEstimateButton } from "./PresentEstimateButton";

const loadSheets = () => import("./EstimateBuilderSheets");
const EstimateBuilderSheets = dynamic(loadSheets, { ssr: false });
const prefetch = () => void loadSheets();

export type BuilderSheet =
  | null
  | "send"
  | "more"
  | "option"
  | "details"
  | "sign"
  | "signpad"
  | "verbal"
  | "decline"
  | "add";

/**
 * Shares the builder's sheet state with controls rendered elsewhere on the page
 * (the booking bar's Send, DESIGN.md §5), so the one primary action can live in
 * the BottomBar / desktop rail while the builder owns the sheets.
 */
const SheetCtx = createContext<{
  sheet: BuilderSheet;
  setSheet: (s: BuilderSheet) => void;
} | null>(null);

export function EstimateActionsProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<BuilderSheet>(null);
  const value = useMemo(() => ({ sheet, setSheet }), [sheet]);
  return <SheetCtx.Provider value={value}>{children}</SheetCtx.Provider>;
}

/** Send / Resend for the booking bar (inside `EstimateActionsProvider`). */
export function EstimateSendButton({
  status,
  disabled,
}: {
  status: string;
  disabled?: boolean;
}) {
  const ctx = useContext(SheetCtx);
  return (
    <Button
      size="lg"
      icon={<Send size={18} aria-hidden />}
      disabled={disabled || !ctx}
      onClick={() => ctx?.setSheet("send")}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      aria-haspopup="dialog"
    >
      {status === "draft" ? "Send" : "Resend"}
    </Button>
  );
}

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
  hidePrimary,
}: {
  /** The page renders Send in its BottomBar (`EstimateSendButton`). */
  hidePrimary?: boolean;
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
  const ctx = useContext(SheetCtx);
  const [localSheet, setLocalSheet] = useState<BuilderSheet>(null);
  const sheet = ctx ? ctx.sheet : localSheet;
  const [armed, setArmed] = useState(false);
  const setSheet = (s: BuilderSheet) => {
    if (s) setArmed(true);
    (ctx ? ctx.setSheet : setLocalSheet)(s);
  };
  // A Send from the booking bar arms the lazy sheets too.
  if (sheet && !armed) setArmed(true);
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
      <div
        className="flex flex-wrap items-center gap-2 print:hidden"
        onPointerOver={prefetch}
        onFocusCapture={prefetch}
      >
        {open && perms.send && !hidePrimary ? (
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
            size={hidePrimary ? "md" : "lg"}
            variant="tinted"
            icon={<PenLine size={18} aria-hidden />}
            className={hidePrimary ? undefined : "flex-1"}
            disabled={!anyLines}
            onClick={() => {
              choose(active?.id ?? "");
              setSheet("sign");
            }}
          >
            Sign here
          </Button>
        ) : null}
        {open && perms.send ? (
          <PresentEstimateButton
            estimateId={e.id}
            size={hidePrimary ? "md" : "lg"}
            disabled={!anyLines}
          />
        ) : null}
        <IconButton
          label="More actions"
          variant="secondary"
          onClick={() => setSheet("more")}
          aria-haspopup="menu"
        >
          <Ellipsis size={20} />
        </IconButton>
      </div>

      {/* Options */}
      <section aria-label="Options" className="space-y-3">
        {(options.length > 1 || editable) && (
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
              <p className="flex-1 px-1 text-subhead text-label-2">
                One option. Add up to two more to offer good, better, best.
              </p>
            )}
            {editable ? (
              <>
                <IconButton
                  label="Option settings"
                  variant="secondary"
                  size={36}
                  onClick={() => setSheet("option")}
                >
                  <SlidersHorizontal size={18} />
                </IconButton>
                {options.length < 3 ? (
                  <IconButton
                    label="Add option"
                    variant="secondary"
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
        )}
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
            header={options.length > 1 ? `${active.label} items` : "Items"}
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

      {armed && (
        <EstimateBuilderSheets
          e={e}
          options={options}
          active={active}
          editable={editable}
          more={more}
          sheet={sheet}
          setSheet={setSheet}
          addOption={addOption}
          pick={pick}
          pickTotals={pickTotals}
          choose={choose}
          addons={addons}
          setAddons={setAddons}
          coolingOff={coolingOff}
          consentText={consentText}
          confirm={confirm}
          start={start}
          setActiveId={setActiveId}
          router={router}
        />
      )}
    </>
  );
}
