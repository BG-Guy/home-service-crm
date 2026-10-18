"use client";

import {
  Ellipsis,
  MessageSquareQuote,
  PenLine,
  Send,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type EditorLine,
  LineEditor,
} from "@/features/invoices/components/LineEditor";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { formatMoney } from "@/lib/money";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListSection } from "@/ui/components/List";
import { usePageActions } from "@/ui/components/PageActions";
import { toast } from "@/ui/components/Toast";
import {
  approveChangeOrderVerbal,
  declineChangeOrder,
  deleteChangeOrderLine,
  saveChangeOrderLine,
  sendChangeOrder,
  signChangeOrderInPerson,
  updateChangeOrder,
} from "../actions";
import { DeclineSheet, SendDocSheet, VerbalApprovalSheet } from "./DocSheets";

// Change order (SPEC M07): the extra work beyond the signed estimate, as its own
// signed document. Approval adds its lines to the job's draft invoice and feeds
// getChangeOrderStatus (B4 start/complete controls).

type Res = { ok: true; data?: unknown } | { ok: false; error: string };
const report = (r: Res, msg?: string) => {
  if (r.ok) {
    if (msg) toast({ title: msg, tone: "success" });
  } else toast({ title: r.error, tone: "error" });
  return r.ok;
};

export function ChangeOrderEditor({
  co,
  lines,
  taxBps,
  taxExempt,
  customerName,
  consentText,
  totalCents,
  previousCents,
  perms,
}: {
  co: { id: string; number: string; status: string; reason: string };
  lines: (EditorLine & { id: string })[];
  taxBps: number;
  taxExempt: boolean;
  customerName: string;
  consentText: string;
  totalCents: number;
  previousCents: number | null;
  perms: {
    create: boolean;
    send: boolean;
    approveOnBehalf: boolean;
    discount: boolean;
    showCost: boolean;
  };
}) {
  const router = useRouter();
  const open = co.status === "draft" || co.status === "sent";
  const editable = open && perms.create;
  const [sheet, setSheet] = useState<
    null | "send" | "more" | "sign" | "verbal" | "decline"
  >(null);
  const [reason, setReason] = useState(co.reason);
  const [pending, start] = useTransition();
  const more: ActionSheetItem[] = [
    ...(open && perms.approveOnBehalf && lines.length
      ? [
          {
            label: "Approve on behalf (verbal)",
            onSelect: () => setSheet("verbal"),
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
  // Desktop: the "…" items live in the action rail.
  const inRail = usePageActions({
    title: co.number,
    subtitle: "Change order",
    groups: [
      {
        title: "Approval",
        actions: more
          .filter((m) => !m.destructive)
          .map((m) => ({
            label: m.label,
            short: "Verbal OK",
            icon: <MessageSquareQuote />,
            onSelect: m.onSelect,
          })),
      },
      {
        actions: more
          .filter((m) => m.destructive)
          .map((m) => ({
            label: m.label,
            short: "Declined",
            icon: <XCircle />,
            destructive: true,
            onSelect: m.onSelect,
          })),
      },
    ],
  });
  return (
    <>
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          {perms.send ? (
            <Button
              size="lg"
              className="flex-1"
              icon={<Send size={18} aria-hidden />}
              disabled={lines.length === 0}
              onClick={() => setSheet("send")}
            >
              Send
            </Button>
          ) : null}
          {perms.send ? (
            <Button
              size="lg"
              variant="tinted"
              className="flex-1"
              icon={<PenLine size={18} aria-hidden />}
              disabled={lines.length === 0}
              onClick={() => setSheet("sign")}
            >
              Sign here
            </Button>
          ) : null}
          {more.length > 0 ? (
            <IconButton
              label="More actions"
              variant="gray"
              className={inRail ? "lg:hidden" : undefined}
              onClick={() => setSheet("more")}
            >
              <Ellipsis size={20} />
            </IconButton>
          ) : null}
        </div>
      ) : null}

      <ListSection header="What changed">
        {editable ? (
          <div className="space-y-2 px-4 py-3">
            <TextArea
              label="Reason"
              hideLabel
              value={reason}
              rows={2}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            {reason.trim() !== co.reason ? (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="tinted"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      report(
                        await updateChangeOrder({
                          changeOrderId: co.id,
                          reason,
                        }),
                        "Saved",
                      );
                    })
                  }
                >
                  Save reason
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-4 py-3 text-body">{co.reason}</p>
        )}
      </ListSection>

      <LineEditor
        variant="change_order"
        header="Additional work"
        lines={lines}
        readOnly={!editable}
        taxBps={taxBps}
        taxExempt={taxExempt}
        allowDiscount={perms.discount}
        showCost={perms.showCost}
        emptyHint="Add the extra parts and labor the customer is approving."
        onSave={async (line) =>
          report(
            await saveChangeOrderLine({
              changeOrderId: co.id,
              line: { ...line, totalCents: undefined } as never,
            }),
            line.id ? "Line saved" : "Line added",
          )
        }
        onDelete={async (id) =>
          report(
            await deleteChangeOrderLine({ changeOrderId: co.id, lineId: id }),
            "Line removed",
          )
        }
      />

      {previousCents != null ? (
        <ListSection footer="The new job total once this change order is approved.">
          <div className="flex items-baseline justify-between px-4 py-3">
            <span className="text-body">Previously approved</span>
            <span className="num">{formatMoney(previousCents)}</span>
          </div>
          <div className="flex items-baseline justify-between px-4 py-3">
            <span className="text-headline">New approved total</span>
            <span className="num text-headline">
              {formatMoney(previousCents + totalCents)}
            </span>
          </div>
        </ListSection>
      ) : null}

      <ActionSheet
        open={sheet === "more"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={co.number}
        items={more}
      />
      <SendDocSheet
        open={sheet === "send"}
        onClose={() => setSheet(null)}
        title={`Send ${co.number}`}
        blurb={`${customerName} gets a secure link to review and sign the change.`}
        send={async (channel) => {
          const r = await sendChangeOrder({ changeOrderId: co.id, channel });
          return r.ok
            ? {
                ok: true,
                data: r.data && { url: r.data.url, status: r.data.status },
              }
            : r;
        }}
      />
      <SignatureSheet
        open={sheet === "sign"}
        onOpenChange={(o) => !o && setSheet(null)}
        title={`Approve ${co.number}`}
        docType="change_order"
        consentText={consentText}
        summaryLines={[
          co.reason,
          `Additional: ${formatMoney(totalCents)}`,
          ...(previousCents != null
            ? [`New total: ${formatMoney(previousCents + totalCents)}`]
            : []),
        ]}
        signerNameDefault={customerName}
        action={(s) => signChangeOrderInPerson({ ...s, changeOrderId: co.id })}
        onSigned={() => {
          setSheet(null);
          router.refresh();
        }}
      />
      <VerbalApprovalSheet
        open={sheet === "verbal"}
        onClose={() => setSheet(null)}
        defaultName={customerName}
        summary={`${co.number}: ${formatMoney(totalCents)} additional.`}
        submit={async (v) => {
          const r = await approveChangeOrderVerbal({
            changeOrderId: co.id,
            ...v,
          });
          return r.ok ? { ok: true } : r;
        }}
      />
      <DeclineSheet
        open={sheet === "decline"}
        onClose={() => setSheet(null)}
        title={`Decline ${co.number}`}
        submit={async (reason) => {
          const r = await declineChangeOrder({
            changeOrderId: co.id,
            reason: reason || null,
          });
          return r.ok ? { ok: true } : r;
        }}
      />
    </>
  );
}
