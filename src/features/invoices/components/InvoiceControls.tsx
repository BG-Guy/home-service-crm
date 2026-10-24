"use client";

import { toast } from "@/ui/components/Toast";
import { deleteInvoiceLine, saveInvoiceLine } from "../actions";
import { type EditorLine, LineEditor } from "./LineEditor";

// The draft invoice's line editor island (calls B3's own actions; the server
// re-renders through refresh() after every mutation) and the props the invoice's
// sheets share (InvoiceSheets, InvoiceActions).

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

/* ------------------------------------------------------------------ shared props */

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
  lines: EditorLine[];
  notes: string | null;
  warrantyText: string | null;
  taxBps: number;
  taxExempt: boolean;
  allowDiscount: boolean;
  showCost: boolean;
  hasPayments: boolean;
}

export type InvoiceSheet =
  | null
  | "revise"
  | "credit"
  | "void"
  | "writeoff"
  | "info"
  | "more";
