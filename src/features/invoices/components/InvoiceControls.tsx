"use client";

import { Ellipsis, FileCheck2, Printer, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState, useTransition } from "react";
import type { ActionSheetItem } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { toast } from "@/ui/components/Toast";
import {
  deleteInvoiceLine,
  getInvoiceLink,
  issueInvoice,
  saveInvoiceLine,
} from "../actions";
import { type EditorLine, LineEditor } from "./LineEditor";

// Client islands of the invoice detail screen. Each calls B3's own actions; the
// server re-renders through refresh() after every mutation.

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

function report(r: Result, success: string): boolean {
  if (r.ok) toast({ title: success, tone: "success" });
  else toast({ title: r.error, tone: "error" });
  return r.ok;
}

/* ------------------------------------------------------------------ draft lines */

export function DraftLines({
  invoiceId,
  lines,
  taxBps,
  taxExempt,
  allowDiscount,
  showCost,
}: {
  invoiceId: string;
  lines: EditorLine[];
  taxBps: number;
  taxExempt: boolean;
  allowDiscount: boolean;
  showCost: boolean;
}) {
  return (
    <LineEditor
      variant="invoice"
      lines={lines}
      taxBps={taxBps}
      taxExempt={taxExempt}
      allowDiscount={allowDiscount}
      showCost={showCost}
      onSave={async (line) => {
        const r = await saveInvoiceLine({
          invoiceId,
          line: {
            ...line,
            isOptional: undefined,
            isSelected: undefined,
            totalCents: undefined,
          } as never,
        });
        return report(r, line.id ? "Line saved" : "Line added");
      }}
      onDelete={async (id) =>
        report(
          await deleteInvoiceLine({ invoiceId, lineId: id }),
          "Line removed",
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ action bar */

export interface InvoiceBarProps {
  invoiceId: string;
  number: string;
  status: string;
  balanceCents: number;
  hasLines: boolean;
  canCreate: boolean;
  canRevise: boolean;
  canVoid: boolean;
  printHref: string;
  /** B4 S19 rendered by the server page (slot), shown when open. */
  collect?: ReactNode;
  lines: EditorLine[];
  notes: string | null;
  warrantyText: string | null;
  taxBps: number;
  taxExempt: boolean;
  allowDiscount: boolean;
  showCost: boolean;
  hasPayments: boolean;
  /**
   * The page shows the primary step (Issue / Collect) in its BottomBar: the bar
   * then keeps only Send, Print and More (one filled primary per view).
   */
  hidePrimary?: boolean;
}

export type InvoiceSheet =
  | null
  | "send"
  | "revise"
  | "credit"
  | "void"
  | "writeoff"
  | "info"
  | "more";

const loadSheets = () => import("./InvoiceSheets");
const InvoiceSheets = dynamic(loadSheets, { ssr: false });
const prefetch = () => void loadSheets();

/** "Issue invoice" with its confirm (the draft's one primary step). */
export function IssueInvoiceButton({
  invoiceId,
  number,
  hasLines,
  block,
  size = "lg",
}: {
  invoiceId: string;
  number: string;
  hasLines: boolean;
  block?: boolean;
  size?: "md" | "lg";
}) {
  const [pending, start] = useTransition();
  const [confirm, confirmEl] = useConfirm();
  // Confirm first, then start the transition (an alert awaited inside an async
  // transition can't commit; QA T2-01).
  const issue = async () => {
    if (
      !(await confirm({
        title: `Issue ${number}?`,
        message:
          "Issued invoices are locked. Later changes create a revision with a reason.",
        confirmLabel: "Issue",
      }))
    )
      return;
    start(async () => {
      report(await issueInvoice({ invoiceId }), "Invoice issued");
    });
  };
  return (
    <>
      {confirmEl}
      <Button
        size={size}
        icon={<FileCheck2 size={19} />}
        loading={pending}
        disabled={!hasLines}
        onClick={issue}
        fullWidth={block}
      >
        Issue invoice
      </Button>
    </>
  );
}

export function InvoiceActionBar(p: InvoiceBarProps) {
  const [sheet, setSheetState] = useState<InvoiceSheet>(null);
  const [armed, setArmed] = useState(false);
  const setSheet = (s: InvoiceSheet) => {
    if (s) setArmed(true);
    setSheetState(s);
  };
  const draft = p.status === "draft";
  const open = p.status === "issued" || p.status === "partially_paid";
  const issued = ["issued", "partially_paid", "paid"].includes(p.status);

  const more: ActionSheetItem[] = [
    ...(draft && p.canCreate
      ? [{ label: "Notes & warranty", onSelect: () => setSheet("info") }]
      : []),
    ...(issued && p.canRevise
      ? [
          { label: "Revise invoice", onSelect: () => setSheet("revise") },
          { label: "Add credit note", onSelect: () => setSheet("credit") },
        ]
      : []),
    { label: "Print / PDF", href: p.printHref },
    ...(open && p.canVoid
      ? [{ label: "Write off", onSelect: () => setSheet("writeoff") }]
      : []),
    ...(p.status !== "void" && p.canVoid && !p.hasPayments
      ? [
          {
            label: "Void invoice",
            destructive: true,
            onSelect: () => setSheet("void"),
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {!p.hidePrimary && draft && p.canCreate && (
          <div className="flex-1">
            <IssueInvoiceButton
              invoiceId={p.invoiceId}
              number={p.number}
              hasLines={p.hasLines}
              block
            />
          </div>
        )}
        {!p.hidePrimary && open && p.collect}
        {issued && p.canCreate && (
          <Button
            size={p.hidePrimary ? "md" : "lg"}
            variant="tinted"
            icon={<Send size={18} />}
            onClick={() => setSheet("send")}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            aria-haspopup="dialog"
            className={p.hidePrimary ? undefined : "flex-1"}
          >
            Send
          </Button>
        )}
        <IconButton label="Print" variant="secondary" href={p.printHref}>
          <Printer size={20} />
        </IconButton>
        <IconButton
          label="More actions"
          variant="secondary"
          onClick={() => setSheet("more")}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-haspopup="menu"
        >
          <Ellipsis size={20} />
        </IconButton>
      </div>
      {armed && (
        <InvoiceSheets p={p} sheet={sheet} setSheet={setSheet} more={more} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ receipt link */

export function ReceiptLinkButton({
  invoiceId,
  paymentId,
}: {
  invoiceId: string;
  paymentId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="plain"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await getInvoiceLink({
            invoiceId,
            receiptPaymentId: paymentId,
          });
          if (r.ok && r.data) window.open(r.data.url, "_blank", "noopener");
          else if (!r.ok) toast({ title: r.error, tone: "error" });
        })
      }
    >
      Receipt
    </Button>
  );
}
