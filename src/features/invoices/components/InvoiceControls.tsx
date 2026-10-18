"use client";

import {
  Ban,
  CircleOff,
  Copy,
  Ellipsis,
  FileCheck2,
  FilePen,
  Mail,
  MessageSquare,
  NotebookPen,
  Printer,
  ReceiptText,
  Send,
  Share2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyField } from "@/ui/components/MoneyField";
import { type PageAction, usePageActions } from "@/ui/components/PageActions";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  addCreditNote,
  deleteInvoiceLine,
  getInvoiceLink,
  issueInvoice,
  markUncollectible,
  reviseInvoice,
  saveInvoiceLine,
  sendInvoice,
  updateInvoiceInfo,
  voidInvoice,
} from "../actions";
import {
  type EditorLine,
  editorTotals,
  LineEditor,
  tempLineId,
} from "./LineEditor";

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
}

export function InvoiceActionBar(p: InvoiceBarProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<
    null | "send" | "revise" | "credit" | "void" | "writeoff" | "info" | "more"
  >(null);
  const [confirm, confirmEl] = useConfirm();
  const draft = p.status === "draft";
  const open = p.status === "issued" || p.status === "partially_paid";
  const issued = ["issued", "partially_paid", "paid"].includes(p.status);

  // Confirm first, then start the transition (an alert awaited inside an async
  // transition can't commit; QA T2-01).
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
      report(await issueInvoice({ invoiceId: p.invoiceId }), "Invoice issued");
    });
  };

  const edit: PageAction[] = [
    ...(draft && p.canCreate
      ? [
          {
            label: "Notes & warranty",
            short: "Notes",
            icon: <NotebookPen />,
            onSelect: () => setSheet("info"),
          },
        ]
      : []),
    ...(issued && p.canRevise
      ? [
          {
            label: "Revise invoice",
            short: "Revise",
            icon: <FilePen />,
            onSelect: () => setSheet("revise"),
          },
          {
            label: "Add credit note",
            short: "Credit note",
            icon: <ReceiptText />,
            onSelect: () => setSheet("credit"),
          },
        ]
      : []),
  ];
  const docs: PageAction[] = [
    ...(issued && p.canCreate
      ? [
          {
            label: "Send to customer",
            short: "Send",
            icon: <Send />,
            onSelect: () => setSheet("send"),
          },
        ]
      : []),
    {
      label: "Print / PDF",
      short: "Print",
      icon: <Printer />,
      href: p.printHref,
    },
  ];
  const danger: PageAction[] = [
    ...(open && p.canVoid
      ? [
          {
            label: "Write off",
            icon: <CircleOff />,
            destructive: true,
            onSelect: () => setSheet("writeoff"),
          },
        ]
      : []),
    ...(p.status !== "void" && p.canVoid && !p.hasPayments
      ? [
          {
            label: "Void invoice",
            short: "Void",
            icon: <Ban />,
            destructive: true,
            onSelect: () => setSheet("void"),
          },
        ]
      : []),
  ];
  const inRail = usePageActions({
    title: p.number,
    subtitle: "Invoice actions",
    groups: [
      { title: "Invoice", actions: edit },
      { title: "Share", actions: docs },
      { actions: danger },
    ],
  });
  // "Send" has its own button; Write off stays a plain (not red) row in the sheet.
  const more: ActionSheetItem[] = [
    ...edit,
    ...docs.filter((a) => a.label !== "Send to customer"),
    ...danger,
  ].map((a) => ({
    label: a.label,
    href: a.href,
    destructive: a.destructive && a.label !== "Write off",
    onSelect: a.onSelect,
  }));

  return (
    <>
      {confirmEl}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {draft && p.canCreate && (
          <Button
            size="lg"
            icon={<FileCheck2 size={19} />}
            loading={pending}
            disabled={!p.hasLines}
            onClick={issue}
            className="flex-1"
          >
            Issue invoice
          </Button>
        )}
        {open && p.collect}
        {issued && p.canCreate && (
          <Button
            size="lg"
            variant="tinted"
            icon={<Send size={18} />}
            onClick={() => setSheet("send")}
            className="flex-1"
          >
            Send
          </Button>
        )}
        <IconButton
          label="Print"
          variant="gray"
          href={p.printHref}
          className={inRail ? "lg:hidden" : undefined}
        >
          <Printer size={20} />
        </IconButton>
        <IconButton
          label="More actions"
          variant="gray"
          className={inRail ? "lg:hidden" : undefined}
          onClick={() => setSheet("more")}
        >
          <Ellipsis size={20} />
        </IconButton>
      </div>

      <ActionSheet
        open={sheet === "more"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={p.number}
        items={more}
      />
      <SendSheet
        open={sheet === "send"}
        onClose={() => setSheet(null)}
        invoiceId={p.invoiceId}
        number={p.number}
        balanceCents={p.balanceCents}
      />
      {sheet === "revise" && (
        <ReviseSheet
          {...p}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            router.refresh();
          }}
        />
      )}
      <ReasonSheet
        open={sheet === "void"}
        onClose={() => setSheet(null)}
        title="Void invoice"
        message="Voiding cancels the invoice. The number stays used and the record is kept."
        cta="Void"
        destructive
        onSubmit={async (reason) =>
          report(
            await voidInvoice({ invoiceId: p.invoiceId, reason }),
            "Invoice voided",
          )
        }
      />
      <ReasonSheet
        open={sheet === "writeoff"}
        onClose={() => setSheet(null)}
        title="Write off"
        message={`Mark the remaining ${formatMoney(p.balanceCents)} as uncollectible. Reminders stop.`}
        cta="Write off"
        destructive
        onSubmit={async (reason) =>
          report(
            await markUncollectible({ invoiceId: p.invoiceId, reason }),
            "Written off",
          )
        }
      />
      <CreditSheet
        open={sheet === "credit"}
        onClose={() => setSheet(null)}
        invoiceId={p.invoiceId}
      />
      <InfoSheet
        open={sheet === "info"}
        onClose={() => setSheet(null)}
        invoiceId={p.invoiceId}
        notes={p.notes}
        warrantyText={p.warrantyText}
      />
    </>
  );
}

/* ------------------------------------------------------------------ send */

function SendSheet({
  open,
  onClose,
  invoiceId,
  number,
  balanceCents,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  number: string;
  balanceCents: number;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const send = (channel: "customer_preferred" | "sms" | "email") =>
    start(async () => {
      const r = await sendInvoice({ invoiceId, channel });
      if (r.ok) {
        toast({
          title:
            r.data?.status === "pending_tap"
              ? "Ready in your outbox — tap to send"
              : "Invoice sent",
          tone: "success",
        });
        setUrl(r.data?.url ?? null);
      } else toast({ title: r.error, tone: "error" });
    });
  const link = () =>
    start(async () => {
      const r = await getInvoiceLink({ invoiceId });
      if (!r.ok || !r.data)
        return void toast({ title: r.ok ? "No link" : r.error, tone: "error" });
      setUrl(r.data.url);
      try {
        if (navigator.share)
          await navigator.share({ title: number, url: r.data.url });
        else {
          await navigator.clipboard.writeText(r.data.url);
          toast({ title: "Link copied", tone: "success" });
        }
      } catch {
        /* share cancelled */
      }
    });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Send ${number}`}
      detents={["content"]}
      trailing={
        <Button variant="plain" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <p className="px-1 text-subhead text-label-2">
          The customer gets a secure link to view, print and pay
          {balanceCents > 0 ? ` the ${formatMoney(balanceCents)} balance` : ""}.
        </p>
        <ListSection>
          <ListRow
            icon={<Send size={17} />}
            title="Preferred channel"
            subtitle="Text or email, whichever they chose"
            onClick={() => send("customer_preferred")}
            disabled={pending}
          />
          <ListRow
            icon={<MessageSquare size={17} />}
            iconTone="green"
            title="Text message"
            onClick={() => send("sms")}
            disabled={pending}
          />
          <ListRow
            icon={<Mail size={17} />}
            iconTone="blue"
            title="Email"
            onClick={() => send("email")}
            disabled={pending}
          />
          <ListRow
            icon={<Share2 size={17} />}
            iconTone="gray"
            title="Share or copy link"
            onClick={link}
            disabled={pending}
          />
        </ListSection>
        {url && (
          <div className="flex items-center gap-2 rounded-card bg-card px-3 py-2 shadow-card">
            <span className="min-w-0 flex-1 truncate text-footnote text-label-2">
              {url}
            </span>
            <IconButton
              label="Copy link"
              size={36}
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast({ title: "Link copied", tone: "success" }))
              }
            >
              <Copy size={18} />
            </IconButton>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ revise */

function ReviseSheet(
  p: InvoiceBarProps & { onClose: () => void; onDone: () => void },
) {
  const [lines, setLines] = useState<EditorLine[]>(() =>
    p.lines.map((l) => ({ ...l })),
  );
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const totals = editorTotals(lines, p.taxBps, p.taxExempt);
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await reviseInvoice({
        invoiceId: p.invoiceId,
        reason,
        lines: lines.map(
          ({ totalCents: _t, isOptional: _o, isSelected: _s, ...l }) => ({
            ...l,
            id: l.id?.startsWith("tmp:") ? undefined : l.id,
          }),
        ) as never,
      });
      if (r.ok) {
        toast({
          title: `Revised to v${r.data?.version ?? ""}`,
          message: r.data?.afterPayment
            ? "Flagged: revised after payment."
            : undefined,
          tone: "success",
        });
        p.onDone();
      } else setError(r.error);
    });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && p.onClose()}
      title={`Revise ${p.number}`}
      dirty
      discardConfirm={{ title: "Discard revision?" }}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={p.onClose}>
          Cancel
        </Button>
      }
      footer={
        <div className="px-[var(--gutter)] py-2">
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={reason.trim().length < 3}
            onClick={submit}
          >
            Save revision · {formatMoney(totals.totalCents)}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--section-gap)] px-[var(--gutter)] pb-6">
        <Banner tone={p.hasPayments ? "warning" : "info"}>
          {p.hasPayments
            ? "This invoice has payments. The revision is kept with its reason and flagged for review."
            : "The current version is kept. The number stays the same and the version goes up."}
        </Banner>
        <LineEditor
          variant="invoice"
          lines={lines}
          taxBps={p.taxBps}
          taxExempt={p.taxExempt}
          allowDiscount={p.allowDiscount}
          showCost={p.showCost}
          onSave={async (l) => {
            setLines((xs) =>
              l.id && xs.some((x) => x.id === l.id)
                ? xs.map((x) => (x.id === l.id ? l : x))
                : [...xs, { ...l, id: `tmp:${tempLineId()}` }],
            );
            return true;
          }}
          onDelete={async (id) => {
            setLines((xs) => xs.filter((x) => x.id !== id));
            return true;
          }}
        />
        <TextArea
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          placeholder="e.g. Customer declined the second remote"
          rows={2}
          maxLength={500}
          error={error}
        />
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ small sheets */

function ReasonSheet({
  open,
  onClose,
  title,
  message,
  cta,
  destructive,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  cta: string;
  destructive?: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <p className="px-1 text-subhead text-label-2">{message}</p>
        <TextArea
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          rows={2}
          maxLength={500}
        />
        <Button
          size="lg"
          variant={destructive ? "destructive" : "filled"}
          disabled={reason.trim().length < 3}
          loading={pending}
          onClick={() =>
            start(async () => {
              if (await onSubmit(reason.trim())) {
                setReason("");
                onClose();
              }
            })
          }
        >
          {cta}
        </Button>
      </div>
    </Sheet>
  );
}

function CreditSheet({
  open,
  onClose,
  invoiceId,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
}) {
  const [cents, setCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Credit note"
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <p className="px-1 text-subhead text-label-2">
          Lowers what the customer owes without changing the issued invoice. If
          they already paid, refund the difference from Payments.
        </p>
        <MoneyField
          label="Amount"
          valueCents={cents}
          onChangeCents={setCents}
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          maxLength={300}
          placeholder="e.g. Goodwill credit for the delay"
        />
        <Button
          size="lg"
          disabled={!cents || cents <= 0 || reason.trim().length < 3}
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await addCreditNote({
                invoiceId,
                amountCents: cents ?? 0,
                reason: reason.trim(),
              });
              if (report(r, "Credit note added")) {
                setCents(null);
                setReason("");
                onClose();
              }
            })
          }
        >
          Add credit
        </Button>
      </div>
    </Sheet>
  );
}

function InfoSheet({
  open,
  onClose,
  invoiceId,
  notes,
  warrantyText,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  notes: string | null;
  warrantyText: string | null;
}) {
  const [n, setN] = useState(notes ?? "");
  const [w, setW] = useState(warrantyText ?? "");
  const [pending, start] = useTransition();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Notes & warranty"
      dirty={n !== (notes ?? "") || w !== (warrantyText ?? "")}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await updateInvoiceInfo({
                invoiceId,
                notes: n.trim() || null,
                warrantyText: w.trim() || null,
              });
              if (report(r, "Saved")) onClose();
            })
          }
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <TextArea
          label="Notes to the customer"
          value={n}
          onChange={(e) => setN(e.currentTarget.value)}
          rows={4}
          maxLength={4000}
        />
        <TextArea
          label="Warranty"
          value={w}
          onChange={(e) => setW(e.currentTarget.value)}
          rows={3}
          maxLength={2000}
        />
      </div>
    </Sheet>
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
