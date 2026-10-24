"use client";

import {
  Ban,
  CreditCard,
  Eye,
  FileCheck2,
  FilePen,
  HandCoins,
  Images,
  NotebookPen,
  PenLine,
  Printer,
  ReceiptText,
  Send,
  Undo2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signJobCompletion } from "@/features/jobs/actions";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { issueInvoice, previewInvoice } from "../actions";
import type { InvoiceBarProps, InvoiceSheet } from "./InvoiceControls";

// The invoice screen's client islands (Quote to Paid, Part I): the bottom bar (Send ·
// Get paid · Send receipt), the More list, Choose photos, the customer sign-off,
// Preview and Receipt. Each sheet is its own lazy chunk, loaded on hover/focus or
// the first tap; the islands themselves load through ./islands.tsx.

const loadPaySheets = () =>
  import("@/features/payments/components/PaymentSheets");
const CollectPaymentSheet = dynamic(
  () => loadPaySheets().then((m) => m.CollectPaymentSheet),
  { ssr: false },
);
const loadReceipt = () => import("@/features/payments/components/ReceiptSheet");
const ReceiptSheet = dynamic(() => loadReceipt().then((m) => m.ReceiptSheet), {
  ssr: false,
});
const loadInvoiceSheets = () => import("./InvoiceSheets");
const SendSheet = dynamic(() => loadInvoiceSheets().then((m) => m.SendSheet), {
  ssr: false,
});
const InvoiceSheets = dynamic(loadInvoiceSheets, { ssr: false });
const loadPhotoSheet = () => import("./InvoicePhotoSheet");
const PhotoSheet = dynamic(
  () => loadPhotoSheet().then((m) => m.InvoicePhotoSheet),
  { ssr: false },
);
const loadSignature = () => import("@/features/signatures/slots.client");
const SignatureSheet = dynamic(
  () => loadSignature().then((m) => m.SignatureSheet),
  { ssr: false },
);
const loadPreview = () => import("./InvoicePreviewHub");
const PreviewHub = dynamic(
  () => loadPreview().then((m) => m.InvoicePreviewHub),
  { ssr: false },
);

const warm = (load: () => Promise<unknown>) => () =>
  void load().catch(() => {});

/** A sheet mounted on first open and kept mounted (its exit motion, its result). */
function useSheets<K extends string>() {
  const [open, setOpen] = useState<K | null>(null);
  const [armed, setArmed] = useState<ReadonlySet<K>>(new Set());
  return {
    open,
    armed: (k: K) => armed.has(k),
    show: (k: K) => {
      setArmed((a) => (a.has(k) ? a : new Set(a).add(k)));
      setOpen(k);
    },
    hide: () => setOpen(null),
    set: (k: K) => (o: boolean) => setOpen(o ? k : null),
  };
}

/* ------------------------------------------------------------------ bottom bar */

export interface InvoicePayBarProps {
  invoiceId: string;
  jobId: string | null;
  number: string;
  status: string;
  balanceCents: number;
  hasLines: boolean;
  /** payments.collect or payments.record_manual. */
  canCollect: boolean;
  /** invoices.create (send, issue). */
  canSend: boolean;
  customerFirstName: string;
  /** Newest completed payment ("Send receipt" on a paid invoice). */
  latestPaymentId: string | null;
  /** `bar`: Send + Get paid (invoice page). `panel`: the one main action (job tab). */
  layout?: "bar" | "panel";
}

/**
 * The invoice's next step: "Send" + "Get paid" (Get paid issues a draft first), or
 * "Send receipt" once it's paid. One instance owns the sheets in every state, so the
 * success screen stays up when a payment turns the invoice paid (the button changes
 * under it; the sheet doesn't unmount).
 */
export function InvoicePayBar(p: InvoicePayBarProps) {
  const s = useSheets<"collect" | "send" | "receipt">();
  const paid = p.status === "paid";
  const closed = p.status === "void" || p.status === "uncollectible";
  const open = !paid && !closed;
  const warmPay = warm(loadPaySheets);
  const warmSend = warm(loadInvoiceSheets);

  const getPaid =
    open && p.canCollect ? (
      <Button
        size="lg"
        fullWidth
        icon={<CreditCard size={20} aria-hidden />}
        onClick={() => s.show("collect")}
        onPointerEnter={warmPay}
        onFocus={warmPay}
        aria-haspopup="dialog"
      >
        Get paid
      </Button>
    ) : null;
  const receipt =
    paid && p.latestPaymentId ? (
      <Button
        size="lg"
        fullWidth
        icon={<ReceiptText size={19} aria-hidden />}
        onClick={() => s.show("receipt")}
        onPointerEnter={warm(loadReceipt)}
        aria-haspopup="dialog"
      >
        Send receipt
      </Button>
    ) : null;
  const sendOk = p.canSend && !closed && !(paid && p.latestPaymentId);
  const send = sendOk ? (
    <Button
      size="lg"
      // The one primary: Get paid, else (a $0 paid invoice) Send itself.
      variant={getPaid || receipt ? "secondary" : "primary"}
      fullWidth={!getPaid}
      icon={<Send size={18} aria-hidden />}
      disabled={p.status === "draft" && !p.hasLines}
      onClick={() => s.show("send")}
      onPointerEnter={warmSend}
      onFocus={warmSend}
      aria-haspopup="dialog"
    >
      Send
    </Button>
  ) : null;
  const main = getPaid ?? receipt ?? (p.layout === "panel" ? null : send);
  const secondary = p.layout === "panel" || main === send ? null : send;

  return (
    <>
      {main || secondary ? (
        <div className="flex items-center gap-2">
          {secondary}
          {main ? <div className="min-w-0 flex-1">{main}</div> : null}
        </div>
      ) : null}
      {s.armed("collect") && (
        <CollectPaymentSheet
          open={s.open === "collect"}
          onOpenChange={s.set("collect")}
          jobId={p.jobId ?? undefined}
          invoiceId={p.invoiceId}
        />
      )}
      {s.armed("send") && (
        <SendSheet
          open={s.open === "send"}
          onClose={s.hide}
          invoiceId={p.invoiceId}
          number={p.number}
          status={p.status}
          balanceCents={p.balanceCents}
          customerFirstName={p.customerFirstName}
        />
      )}
      {s.armed("receipt") && p.latestPaymentId && (
        <ReceiptSheet
          open={s.open === "receipt"}
          onOpenChange={s.set("receipt")}
          paymentId={p.latestPaymentId}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ more */

/** The rest of the invoice's actions as named rows (no "…" menu). */
export function InvoiceMoreActions(p: InvoiceBarProps) {
  const [sheet, setSheetState] = useState<InvoiceSheet>(null);
  const [armed, setArmed] = useState(false);
  const setSheet = (x: InvoiceSheet) => {
    if (x) setArmed(true);
    setSheetState(x);
  };
  const [confirm, confirmEl] = useConfirm();
  const [pending, start] = useTransition();
  const draft = p.status === "draft";
  const open = p.status === "issued" || p.status === "partially_paid";
  const issued = ["issued", "partially_paid", "paid"].includes(p.status);
  const warmSheets = warm(loadInvoiceSheets);

  // Confirm first, then start the transition (QA T2-01).
  const issue = async () => {
    if (
      !(await confirm({
        title: `Issue ${p.number}?`,
        message:
          "Issued invoices are locked. Later changes create a revision with a reason.",
        confirmLabel: "Issue",
      }))
    )
      return;
    start(async () => {
      const r = await issueInvoice({ invoiceId: p.invoiceId });
      if (r.ok) toast({ title: "Invoice issued", tone: "success" });
      else toast({ title: r.error, tone: "error" });
    });
  };

  return (
    <div onPointerEnter={warmSheets} onFocusCapture={warmSheets}>
      {confirmEl}
      <ListSection header="More">
        {draft && p.canCreate && (
          <ListRow
            icon={<NotebookPen size={17} />}
            iconTone="gray"
            title="Notes and warranty"
            onClick={() => setSheet("info")}
          />
        )}
        {draft && p.canCreate && (
          <ListRow
            icon={<FileCheck2 size={17} />}
            iconTone="gray"
            title="Issue invoice"
            subtitle="Lock it now, without sending or getting paid"
            onClick={issue}
            disabled={!p.hasLines || pending}
            multiline
          />
        )}
        {issued && p.canRevise && (
          <ListRow
            icon={<FilePen size={17} />}
            iconTone="gray"
            title="Revise invoice"
            onClick={() => setSheet("revise")}
          />
        )}
        {issued && p.canRevise && (
          <ListRow
            icon={<Undo2 size={17} />}
            iconTone="gray"
            title="Add credit note"
            onClick={() => setSheet("credit")}
          />
        )}
        <ListRow
          icon={<Printer size={17} />}
          iconTone="gray"
          title="Print or PDF"
          href={p.printHref}
        />
        {open && p.canVoid && (
          <ListRow
            icon={<HandCoins size={17} />}
            iconTone="gray"
            title="Write off"
            onClick={() => setSheet("writeoff")}
          />
        )}
        {p.status !== "void" && p.canVoid && !p.hasPayments && (
          <ListRow
            icon={<Ban size={17} />}
            iconTone="red"
            title="Void invoice"
            destructive
            onClick={() => setSheet("void")}
          />
        )}
      </ListSection>
      {armed && (
        <InvoiceSheets p={p} sheet={sheet} setSheet={setSheet} more={[]} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ photos */

export function ChoosePhotosButton({
  invoiceId,
  jobId,
  selected,
  issued,
}: {
  invoiceId: string;
  jobId: string;
  selected: string[];
  issued: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const warmPhotos = warm(loadPhotoSheet);
  return (
    <>
      <Button
        variant="tinted"
        icon={<Images size={18} aria-hidden />}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
        onPointerEnter={warmPhotos}
        onFocus={warmPhotos}
        aria-haspopup="dialog"
      >
        Choose photos
      </Button>
      {armed && (
        <PhotoSheet
          open={open}
          onOpenChange={setOpen}
          invoiceId={invoiceId}
          jobId={jobId}
          selected={selected}
          issued={issued}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ sign-off */

/** "Get customer sign-off": the e-sign sheet for the job's completion (kept legal text). */
export function SignOffButton({
  jobId,
  customerName,
  consentText,
  summaryLines,
}: {
  jobId: string;
  customerName: string;
  consentText: string;
  summaryLines: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const warmSig = warm(loadSignature);
  return (
    <>
      <Button
        variant="tinted"
        icon={<PenLine size={18} aria-hidden />}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
        onPointerEnter={warmSig}
        onFocus={warmSig}
        aria-haspopup="dialog"
      >
        Get customer sign-off
      </Button>
      {armed && (
        <SignatureSheet
          title="Customer sign-off"
          docType="completion"
          consentText={consentText}
          summaryLines={summaryLines}
          signerNameDefault={customerName}
          action={signJobCompletion.bind(null, jobId)}
          open={open}
          onOpenChange={setOpen}
          onSigned={() => router.refresh()}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ preview */

/** "Preview": the customer's own page, full screen, nothing tracked (Quote to Paid I6). */
export function PreviewButton({
  invoiceId,
  customerFirstName,
}: {
  invoiceId: string;
  customerFirstName: string;
}) {
  const [pending, start] = useTransition();
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const warmHub = warm(loadPreview);
  const go = () =>
    start(async () => {
      warmHub();
      if (src) {
        setOpen(true);
        return;
      }
      const r = await previewInvoice({ invoiceId });
      if (r.ok && r.data) {
        setSrc(r.data.href);
        setOpen(true);
      } else if (!r.ok) toast({ title: r.error, tone: "error" });
    });
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        icon={<Eye size={18} aria-hidden />}
        loading={pending}
        onClick={go}
        onPointerEnter={warmHub}
        onFocus={warmHub}
        aria-haspopup="dialog"
      >
        Preview
      </Button>
      {src && (
        <PreviewHub
          src={src}
          open={open}
          onOpenChange={setOpen}
          customerFirstName={customerFirstName}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ receipt */

/** "Receipt": the payment's receipt in the app (no new tab after a round trip). */
export function ReceiptButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const warmReceipt = warm(loadReceipt);
  return (
    <>
      <Button
        size="sm"
        variant="plain"
        icon={<ReceiptText size={16} aria-hidden />}
        onClick={() => {
          setArmed(true);
          setOpen(true);
        }}
        onPointerEnter={warmReceipt}
        onFocus={warmReceipt}
        aria-haspopup="dialog"
      >
        Receipt
      </Button>
      {armed && (
        <ReceiptSheet
          open={open}
          onOpenChange={setOpen}
          paymentId={paymentId}
        />
      )}
    </>
  );
}
