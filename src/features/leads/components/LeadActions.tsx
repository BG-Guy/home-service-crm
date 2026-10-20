"use client";

import {
  CalendarPlus,
  Ellipsis,
  MessageSquare,
  Phone,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  QuickActionIcon,
  QuickActionLink,
  QuickActionRow,
  quickActionCls,
} from "@/features/customers/components/QuickActions";
import type { ActionSheetItem } from "@/ui/components/ActionSheet";
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

// Convert / More / Lost overlays: their own chunk, fetched on hover, focus or tap.
const loadSheets = () => import("./LeadActionsSheets");
const LeadActionsSheets = dynamic(loadSheets, { ssr: false });
const prefetch = () => void loadSheets();

/**
 * Lead hero actions: a row of round quick actions (Call, Text, Book, More) with
 * the next step filled (Call while it's new, Book once contacted), then Claim /
 * Looks legit as neutral pills.
 */
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
  const [armed, setArmed] = useState(false);
  const [convertOpen, setConvertState] = useState(false);
  const [moreOpen, setMoreState] = useState(false);
  const [lostOpen, setLostState] = useState(false);
  const [busy, setBusy] = useState(false);
  const arm =
    (set: (v: boolean) => void) =>
    (v: boolean): void => {
      if (v) setArmed(true);
      set(v);
    };
  const setConvertOpen = arm(setConvertState);
  const setMoreOpen = arm(setMoreState);
  const setLostOpen = arm(setLostState);
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

  const canCall = canEdit && open && hasPhone;
  const canBook = canConvert && open;
  // The one filled circle: call a new lead first, book it once you've talked.
  const callIsNext = canCall && (status === "new" || !canBook);
  const claimable = canEdit && open && !assignedToMe;

  return (
    <div className="flex flex-col gap-4">
      <QuickActionRow label="Lead actions" className="justify-start">
        {canCall && (
          <LeadCallButton
            leadId={leadId}
            render={({ onClick, busy: calling }) => (
              <button
                type="button"
                onClick={onClick}
                disabled={calling}
                aria-busy={calling || undefined}
                className={quickActionCls}
              >
                <QuickActionIcon primary={callIsNext}>
                  <Phone />
                </QuickActionIcon>
                <span>Call</span>
              </button>
            )}
          />
        )}
        {open && (customerId || phone) && (
          <QuickActionLink
            href={customerId ? `/messages/${customerId}` : `sms:${phone}`}
            external={!customerId}
            icon={<MessageSquare />}
            label="Text"
          />
        )}
        {canBook && (
          <button
            type="button"
            disabled={busy}
            onPointerEnter={estimatesOn ? prefetch : undefined}
            onFocus={estimatesOn ? prefetch : undefined}
            onClick={() =>
              estimatesOn ? setConvertOpen(true) : convert("job")
            }
            aria-haspopup={estimatesOn ? "menu" : undefined}
            className={quickActionCls}
          >
            <QuickActionIcon primary={!callIsNext}>
              <CalendarPlus />
            </QuickActionIcon>
            <span>Book</span>
          </button>
        )}
        {more.length > 0 && (
          <button
            type="button"
            onPointerEnter={prefetch}
            onFocus={prefetch}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="menu"
            className={quickActionCls}
          >
            <span
              aria-hidden
              className="btn btn-secondary size-[52px] [&>svg]:size-[22px]"
            >
              <Ellipsis />
            </span>
            <span>More</span>
          </button>
        )}
      </QuickActionRow>

      {(claimable || (canEdit && flagged)) && (
        <div className="flex flex-wrap gap-2">
          {claimable && (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              icon={<UserCheck size={16} aria-hidden />}
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
              variant="secondary"
              size="sm"
              icon={<ShieldCheck size={16} aria-hidden />}
              onClick={() =>
                run(() => markLeadNotSpam({ leadId }), "Moved to the inbox")
              }
            >
              Looks legit
            </Button>
          )}
        </div>
      )}

      {armed && (
        <LeadActionsSheets
          leadId={leadId}
          lostReasons={lostReasons}
          more={more}
          convert={convert}
          convertOpen={convertOpen}
          setConvertOpen={setConvertOpen}
          moreOpen={moreOpen}
          setMoreOpen={setMoreOpen}
          lostOpen={lostOpen}
          setLostOpen={setLostOpen}
        />
      )}
    </div>
  );
}
