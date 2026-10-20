"use client";

import {
  CalendarDays,
  CalendarPlus,
  MapPin,
  MessageSquare,
  Repeat,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { Morph } from "@/ui/motion/Morph";
import { claimLead, markLeadSpam, prepareLeadConversion } from "../actions";
import type { LeadListItem } from "../contracts";
import { lostReasonLabel, SOURCE_KIND_LABEL } from "../labels";
import { LeadCallButton } from "./LeadCallButton";
import { SlaTimer } from "./SlaTimer";

// "Lost" (from the swipe) opens a sheet: its own chunk, loaded on first swipe.
const LostSheet = dynamic(
  () => import("./LostSheet").then((m) => m.LostSheet),
  { ssr: false },
);

const OPEN = new Set(["new", "contacted", "qualified"]);

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, day)));
}

/**
 * One inbox card (DESIGN.md §7 brief 4): the SLA ring leads (an avatar once it's
 * closed), bold name (M3 `lead-<id>-title`), service and phone, the quote on the
 * right, a meta line, then Call / Text / Book quick actions and Claim.
 */
export function LeadCard({
  lead,
  viewerId,
  canEdit,
  canConvert = false,
  lostReasons,
  active,
}: {
  lead: LeadListItem;
  viewerId: string;
  canEdit: boolean;
  canConvert?: boolean;
  lostReasons: string[];
  active?: boolean;
}) {
  const router = useRouter();
  const [lostOpen, setLostOpenState] = useState(false);
  const [lostArmed, setLostArmed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [booking, setBooking] = useState(false);
  const open = OPEN.has(lead.status);
  const mine = lead.assignedUserId === viewerId;
  const href = `/leads/${lead.id}`;
  const setLostOpen = (v: boolean) => {
    if (v) setLostArmed(true);
    setLostOpenState(v);
  };

  const claim = async () => {
    setClaiming(true);
    const r = await claimLead({ leadId: lead.id });
    setClaiming(false);
    if (r.ok) toast.success("Claimed — it's yours");
    else toast.error(r.error);
  };

  const book = async () => {
    setBooking(true);
    const r = await prepareLeadConversion({ leadId: lead.id, to: "job" });
    setBooking(false);
    if (!r.ok || !r.data)
      return void toast.error(r.ok ? "Couldn't convert" : r.error);
    router.push(r.data.href);
  };

  const title = (
    <h3 className="inline-block max-w-full truncate align-bottom text-headline">
      {lead.name}
    </h3>
  );

  const body = (
    <article
      className={cx(
        "card flex flex-col gap-3 p-4",
        active && "ring-2 ring-accent",
      )}
      aria-label={`Lead ${lead.name}`}
    >
      <div className="flex items-start gap-3">
        {open ? (
          <SlaTimer
            variant="ring"
            createdAt={lead.createdAt}
            respondedAt={lead.firstResponseAt}
          />
        ) : (
          <Avatar
            name={lead.name}
            seed={lead.customerId ?? lead.id}
            size={48}
          />
        )}
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className="min-w-0 flex-1 self-center rounded-control focus-visible:outline-2"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {active ? (
              title
            ) : (
              <Morph name={`lead-${lead.id}-title`}>{title}</Morph>
            )}
            {lead.isReturning && (
              <Repeat
                size={14}
                className="shrink-0 text-accent-text"
                aria-label="Returning customer"
              />
            )}
          </div>
          <p className="num truncate text-subhead text-label-2">
            {[lead.service ?? "Service not given", lead.phoneDisplay]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1 self-center">
          {open ? (
            lead.quotedPriceCents != null ? (
              <MoneyText
                cents={lead.quotedPriceCents}
                className="text-headline"
              />
            ) : null
          ) : (
            <StatusPill
              kind="lead"
              status={lead.status}
              size="sm"
              label={
                lead.status === "lost" && lead.lostReason
                  ? `Lost · ${lostReasonLabel(lead.lostReason)}`
                  : undefined
              }
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {lead.sourceName && (
          <Pill tone="gray" dot={false} size="sm">
            {lead.sourceName || SOURCE_KIND_LABEL[lead.sourceKind ?? ""]}
          </Pill>
        )}
        {lead.flagged && (
          <Pill tone="orange" size="sm">
            Check · {lead.spamScore}
          </Pill>
        )}
        {lead.isTest && (
          <Pill tone="gray" size="sm">
            Test
          </Pill>
        )}
        {open && lead.status !== "new" && (
          <StatusPill kind="lead" status={lead.status} size="sm" />
        )}
        {!open && lead.quotedPriceCents != null && (
          <MoneyText
            cents={lead.quotedPriceCents}
            className="text-footnote font-semibold"
          />
        )}
        {lead.preferredDate && (
          <span className="inline-flex items-center gap-1 text-footnote text-label-2">
            <CalendarDays size={13} aria-hidden />
            {fmtDate(lead.preferredDate)}
            {lead.preferredWindow ? ` · ${lead.preferredWindow}` : ""}
          </span>
        )}
        {lead.zip && (
          <span
            className={cx(
              "inline-flex items-center gap-1 text-footnote",
              lead.inServiceArea === false ? "text-danger" : "text-label-2",
            )}
          >
            <MapPin size={13} aria-hidden />
            {lead.zip}
            {lead.inServiceArea === false
              ? " · outside area"
              : lead.inServiceArea
                ? " · in area"
                : ""}
          </span>
        )}
      </div>
      {lead.notes && (
        <p className="line-clamp-2 text-footnote text-label-2">{lead.notes}</p>
      )}
      {open && canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          {lead.hasPhone && <LeadCallButton leadId={lead.id} />}
          {lead.customerId ? (
            <Button
              variant="secondary"
              size="sm"
              href={`/messages/${lead.customerId}`}
              icon={<MessageSquare size={16} aria-hidden />}
            >
              Text
            </Button>
          ) : null}
          {canConvert && (
            <Button
              variant="secondary"
              size="sm"
              onClick={book}
              loading={booking}
              icon={<CalendarPlus size={16} aria-hidden />}
            >
              Book
            </Button>
          )}
          {!lead.assignedUserId ? (
            <Button
              variant="plain"
              size="sm"
              onClick={claim}
              loading={claiming}
              className="ml-auto"
            >
              Claim
            </Button>
          ) : (
            <span className="ml-auto truncate text-footnote text-label-2">
              {mine ? "Yours" : lead.assignedName}
            </span>
          )}
        </div>
      )}
    </article>
  );

  if (!open || !canEdit) return body;
  return (
    <>
      <SwipeActions
        trailing={[
          { label: "Lost", tone: "gray", onAction: () => setLostOpen(true) },
          {
            label: "Spam",
            destructive: true,
            onAction: async () => {
              const r = await markLeadSpam({ leadId: lead.id });
              if (r.ok) toast.success("Marked as spam");
              else toast.error(r.error);
            },
          },
        ]}
      >
        {body}
      </SwipeActions>
      {lostArmed && (
        <LostSheet
          leadId={lead.id}
          reasons={lostReasons}
          open={lostOpen}
          onOpenChange={setLostOpen}
        />
      )}
    </>
  );
}
