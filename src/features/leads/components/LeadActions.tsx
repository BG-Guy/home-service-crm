"use client";

import {
  CalendarPlus,
  Ellipsis,
  FileSignature,
  MessageSquare,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import {
  claimLead,
  markLeadNotSpam,
  markLeadSpam,
  prepareLeadConversion,
  setLeadStatus,
} from "../actions";
import type { LeadStatus } from "../contracts";
import { LeadCallButton } from "./LeadCallButton";
import { LostSheet } from "./LostSheet";

/** Detail action bar: Call, Text, Claim, Convert (job / estimate) and More. */
export function LeadActions({
  leadId,
  status,
  hasPhone,
  phone,
  customerId,
  assignedToMe,
  assigned,
  flagged,
  canEdit,
  canConvert,
  estimatesOn,
  lostReasons,
}: {
  leadId: string;
  status: LeadStatus;
  hasPhone: boolean;
  phone: string | null;
  customerId: string | null;
  assignedToMe: boolean;
  assigned: boolean;
  flagged: boolean;
  canEdit: boolean;
  canConvert: boolean;
  estimatesOn: boolean;
  lostReasons: string[];
}) {
  const router = useRouter();
  const [convertOpen, setConvertOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const open =
    status === "new" || status === "contacted" || status === "qualified";

  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
  ) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) toast.success(ok);
    else toast.error(r.error ?? "Something went wrong");
  };

  const convert = async (to: "job" | "estimate") => {
    setBusy(true);
    const r = await prepareLeadConversion({ leadId, to });
    setBusy(false);
    if (!r.ok || !r.data)
      return void toast.error(r.ok ? "Couldn't convert" : r.error);
    router.push(r.data.href);
  };

  const more: ActionSheetItem[] = [];
  if (canEdit && open && status !== "qualified")
    more.push({
      label: "Mark qualified",
      onSelect: () =>
        run(
          () => setLeadStatus({ leadId, status: "qualified" }),
          "Marked qualified",
        ),
    });
  if (canEdit && (status === "lost" || status === "spam"))
    more.push({
      label: "Reopen",
      onSelect: () =>
        run(
          () =>
            status === "spam"
              ? markLeadNotSpam({ leadId })
              : setLeadStatus({ leadId, status: "contacted" }),
          "Reopened",
        ),
    });
  if (canEdit && open)
    more.push({ label: "Mark lost…", onSelect: () => setLostOpen(true) });
  if (canEdit && status !== "spam" && status !== "booked")
    more.push({
      label: "Mark as spam",
      destructive: true,
      onSelect: () => run(() => markLeadSpam({ leadId }), "Marked as spam"),
    });

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && open && hasPhone && (
        <LeadCallButton leadId={leadId} variant="filled" size="md" />
      )}
      {open && (customerId || phone) && (
        <Button
          variant="tinted"
          size="md"
          href={customerId ? `/messages/${customerId}` : `sms:${phone}`}
          icon={<MessageSquare size={18} aria-hidden />}
        >
          Text
        </Button>
      )}
      {canEdit && open && !assignedToMe && (
        <Button
          variant="tinted"
          size="md"
          loading={busy}
          icon={<UserCheck size={18} aria-hidden />}
          onClick={() =>
            run(
              () => claimLead({ leadId, force: assigned }),
              assigned ? "Reassigned to you" : "Claimed",
            )
          }
        >
          {assigned ? "Take over" : "Claim"}
        </Button>
      )}
      {canEdit && flagged && (
        <Button
          variant="tinted"
          size="md"
          icon={<ShieldCheck size={18} aria-hidden />}
          onClick={() =>
            run(() => markLeadNotSpam({ leadId }), "Moved to the inbox")
          }
        >
          Looks legit
        </Button>
      )}
      {canConvert && open && (
        <Button
          variant="tinted"
          size="md"
          loading={busy}
          icon={<CalendarPlus size={18} aria-hidden />}
          onClick={() => (estimatesOn ? setConvertOpen(true) : convert("job"))}
        >
          Convert
        </Button>
      )}
      {more.length > 0 && (
        <Button
          variant="gray"
          size="md"
          aria-label="More actions"
          icon={<Ellipsis size={18} aria-hidden />}
          onClick={() => setMoreOpen(true)}
        >
          More
        </Button>
      )}
      <ActionSheet
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert lead"
        message="Customer, address, service, price and preferred date are filled in for you."
        items={[
          {
            label: "Book a job",
            icon: <CalendarPlus size={18} aria-hidden />,
            onSelect: () => convert("job"),
          },
          {
            label: "Send an estimate",
            icon: <FileSignature size={18} aria-hidden />,
            onSelect: () => convert("estimate"),
          },
        ]}
      />
      <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} items={more} />
      <LostSheet
        leadId={leadId}
        reasons={lostReasons}
        open={lostOpen}
        onOpenChange={setLostOpen}
      />
    </div>
  );
}
