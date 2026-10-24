"use client";

import { PenLine, Plus, Printer, Star } from "lucide-react";
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
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
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
 * Shares the builder's sheet state and the SELECTED OPTION with controls rendered
 * elsewhere on the page (the bottom bar's total, Send and Present, DESIGN.md §5),
 * so the bar always shows the option on screen (Quote to Paid E2).
 */
const SheetCtx = createContext<{
  sheet: BuilderSheet;
  setSheet: (s: BuilderSheet) => void;
  activeId: string;
  setActiveId: (id: string) => void;
} | null>(null);

export function EstimateActionsProvider({
  children,
  initialOptionId = "",
}: {
  children: ReactNode;
  /** The option shown first (the recommended one). */
  initialOptionId?: string;
}) {
  const [sheet, setSheet] = useState<BuilderSheet>(null);
  const [activeId, setActiveId] = useState(initialOptionId);
  const value = useMemo(
    () => ({ sheet, setSheet, activeId, setActiveId }),
    [sheet, activeId],
  );
  return <SheetCtx.Provider value={value}>{children}</SheetCtx.Provider>;
}

/**
 * The builder's sticky bar: the selected option's total, Send second and Present
 * as the one main button (inside `EstimateActionsProvider`).
 */
export function EstimateBar({
  estimateId,
  status,
  options,
  canSend,
}: {
  estimateId: string;
  status: string;
  options: {
    id: string;
    label: string;
    recommended: boolean;
    totalCents: number;
    lineCount: number;
  }[];
  canSend: boolean;
}) {
  const ctx = useContext(SheetCtx);
  const sel =
    options.find((o) => o.id === ctx?.activeId) ??
    options.find((o) => o.recommended) ??
    options[0];
  const anyLines = options.some((o) => o.lineCount > 0);
  const multi = options.length > 1;
  return (
    <BottomBar
      label="Estimate actions"
      summary={
        <BarSummary
          title={<MoneyText cents={sel?.totalCents ?? 0} />}
          subtitle={multi ? `${sel?.label} · tax included` : "Tax included"}
        />
      }
      secondary={
        canSend ? (
          <Button
            size="lg"
            variant="secondary"
            disabled={!anyLines || !ctx}
            onClick={() => ctx?.setSheet("send")}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            aria-haspopup="dialog"
          >
            {status === "draft" ? "Send" : "Resend"}
          </Button>
        ) : null
      }
      action={
        canSend ? (
          <PresentEstimateButton
            estimateId={estimateId}
            size="lg"
            variant="primary"
            disabled={!anyLines}
          />
        ) : null
      }
    />
  );
}

// Estimate builder (SPEC M07, Quote to Paid E2): option pills (label + total, the
// selected one filled in the stage color, ★ recommended, "+ Option"), the option's
// item cards with inline steppers, the price book one tap per item, then Sign here
// / Present / Send; details, verbal approval and decline in lazy sheets.

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

const lineTotalsOf = (o: BuilderOption) =>
  o.lines.map((l) => ({
    id: l.id,
    type: l.type,
    totalCents: l.totalCents ?? 0,
    taxable: l.type === "discount" ? false : (l.taxable ?? false),
    isOptional: l.isOptional,
    isSelected: l.isSelected,
  }));

export function EstimateBuilder({
  estimate: e,
  options,
  taxBps,
  taxExempt,
  open,
  perms,
  consentText,
  coolingOff,
  actions,
  children,
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
  /** More buttons next to Add items (e.g. Photos). */
  actions?: ReactNode;
  /** Shown between the option card and the named actions (e.g. the photos). */
  children?: ReactNode;
}) {
  const router = useRouter();
  const ctx = useContext(SheetCtx);
  const [localActive, setLocalActive] = useState(
    options.find((o) => o.recommended)?.id ?? options[0]?.id ?? "",
  );
  const activeId = ctx?.activeId || localActive;
  const setActiveId = ctx ? ctx.setActiveId : setLocalActive;
  const active = options.find((o) => o.id === activeId) ?? options[0];
  const [localSheet, setLocalSheet] = useState<BuilderSheet>(null);
  const sheet = ctx ? ctx.sheet : localSheet;
  const [armed, setArmed] = useState(false);
  const setSheet = (s: BuilderSheet) => {
    if (s) setArmed(true);
    (ctx ? ctx.setSheet : setLocalSheet)(s);
  };
  // A Send from the bottom bar arms the lazy sheets too.
  if (sheet && !armed) setArmed(true);
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  const editable = open && perms.create;
  const anyLines = options.some((o) => o.lines.length > 0);

  const totals = useMemo(
    () =>
      Object.fromEntries(
        options.map((o) => [
          o.id,
          optionTotals(lineTotalsOf(o), taxBps, { taxExempt }).totalCents,
        ]),
      ),
    [options, taxBps, taxExempt],
  );

  // Selection used by "Sign here" and "Approve on behalf".
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
        ? optionTotals(lineTotalsOf(pick), taxBps, {
            taxExempt,
            selectedAddonIds: addons,
          })
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
  ];
  const reopenable =
    ["declined", "expired", "superseded"].includes(e.status) && perms.create;
  const multi = options.length > 1;
  const showPills = multi || editable;

  return (
    <>
      {confirmEl}
      <section aria-label="Options" className="space-y-3">
        {showPills ? (
          <OptionPills
            options={options}
            totals={totals}
            activeId={active?.id ?? ""}
            onSelect={setActiveId}
            onAdd={
              editable && options.length < 3
                ? () =>
                    active && active.lines.length > 0
                      ? setSheet("add")
                      : addOption(false)
                : undefined
            }
            adding={pending}
          />
        ) : null}
        {active ? (
          <LineEditor
            key={active.id}
            layout="cards"
            variant="estimate"
            header={`${active.label} items`}
            pickerTitle={`Add to ${active.label}`}
            lines={active.lines}
            readOnly={!editable}
            taxBps={taxBps}
            taxExempt={taxExempt}
            allowDiscount={perms.discount}
            showCost={perms.showCost}
            emptyHint="Tap Add items to pick from the price book. Mark extras as add-ons the customer can tick."
            cardHeader={
              <OptionHeader
                option={active}
                multi={multi}
                onEdit={editable ? () => setSheet("option") : undefined}
                onPrefetch={prefetch}
              />
            }
            actions={actions}
            onSave={async (line, o) => {
              const r = await saveEstimateLine({
                optionId: active.id,
                line: { ...line, totalCents: undefined } as never,
              });
              if (
                !report(
                  r,
                  o?.quiet ? undefined : line.id ? "Item saved" : "Item added",
                )
              )
                return false;
              const id = r.ok
                ? (r.data as { lineId?: string | null })?.lineId
                : null;
              return id ? { id } : true;
            }}
            onDelete={async (id, o) =>
              report(
                await deleteEstimateLine({ optionId: active.id, lineId: id }),
                o?.quiet ? undefined : "Item removed",
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

      {children}

      {/* Named actions (no lone "…"). */}
      <div
        className="flex flex-wrap gap-2 print:hidden"
        onPointerOver={prefetch}
        onFocusCapture={prefetch}
      >
        {open && perms.send ? (
          <Button
            variant="tinted"
            icon={<PenLine size={18} aria-hidden />}
            disabled={!anyLines || !active?.lines.length}
            onClick={() => {
              choose(active?.id ?? "");
              setSheet("sign");
            }}
          >
            Sign here
          </Button>
        ) : null}
        <Button
          variant="secondary"
          href={e.printHref}
          icon={<Printer size={17} aria-hidden />}
        >
          Print or PDF
        </Button>
        {more.length > 0 ? (
          <Button
            variant="secondary"
            onClick={() => setSheet("more")}
            aria-haspopup="menu"
          >
            More
          </Button>
        ) : null}
        {reopenable ? (
          <Button
            variant="tinted"
            loading={pending}
            onClick={() =>
              start(async () => {
                report(await reopenEstimate({ estimateId: e.id }), "Reopened");
              })
            }
          >
            Reopen estimate
          </Button>
        ) : null}
      </div>

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

/** Option pills: label + total, the selected one filled, ★ recommended, + Option. */
function OptionPills({
  options,
  totals,
  activeId,
  onSelect,
  onAdd,
  adding,
}: {
  options: BuilderOption[];
  totals: Record<string, number>;
  activeId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  adding?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Options"
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))${onAdd ? " auto" : ""}`,
      }}
    >
      {options.map((o) => {
        const on = o.id === activeId;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a pill, not a form radio
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(o.id)}
            className={cx(
              "pressable flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-2 py-2 text-center outline-offset-2 transition-[background-color,box-shadow] duration-[var(--dur-quick)]",
              on
                ? "bg-accent-fill text-on-accent"
                : "bg-card text-label shadow-card",
            )}
            style={
              on
                ? {
                    boxShadow:
                      "0 8px 22px -8px color-mix(in srgb, var(--accent) 70%, transparent)",
                  }
                : undefined
            }
          >
            <span className="flex max-w-full items-center gap-1 text-headline">
              {o.recommended ? (
                <Star
                  size={13}
                  aria-label="Recommended"
                  fill="currentColor"
                  className="shrink-0"
                />
              ) : null}
              <span className="truncate">{o.label}</span>
            </span>
            <span
              className={cx(
                "num whitespace-nowrap text-subhead font-medium",
                on ? "opacity-85" : "text-label-2",
              )}
            >
              {formatMoney(totals[o.id] ?? 0)}
            </span>
          </button>
        );
      })}
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="pressable flex min-h-16 items-center justify-center gap-1 rounded-[18px] bg-fill-2 px-3.5 text-subhead font-semibold text-accent-text outline-offset-2 disabled:opacity-50"
        >
          <Plus size={17} aria-hidden strokeWidth={2.4} />
          Option
        </button>
      ) : null}
    </div>
  );
}

/** The option card's header: its name, notes, Recommended and "Edit option". */
function OptionHeader({
  option: o,
  multi,
  onEdit,
  onPrefetch,
}: {
  option: BuilderOption;
  multi: boolean;
  onEdit?: () => void;
  onPrefetch: () => void;
}) {
  return (
    <div className="flex items-start gap-2 pb-1.5">
      <div className="min-w-0 flex-1 pt-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-headline">{o.label}</span>
          {o.recommended && multi ? (
            <span className="inline-flex items-center gap-1 rounded-pill bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] px-2.5 py-0.5 text-footnote font-semibold text-[var(--ink-accent)]">
              <Star size={12} aria-hidden fill="currentColor" />
              Recommended
            </span>
          ) : null}
        </p>
        {o.notes ? (
          <p className="mt-0.5 text-subhead text-label-2">{o.notes}</p>
        ) : null}
      </div>
      {onEdit ? (
        <Button
          variant="plain"
          size="sm"
          className="-mr-2 shrink-0"
          onClick={onEdit}
          onPointerEnter={onPrefetch}
          aria-haspopup="dialog"
        >
          Edit option
        </Button>
      ) : null}
    </div>
  );
}
