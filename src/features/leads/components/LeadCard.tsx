"use client";

import {
  CalendarDays,
  MapPin,
  MessageSquare,
  Repeat,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/ui/components/Button";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { claimLead, markLeadSpam } from "../actions";
import type { LeadListItem } from "../contracts";
import { lostReasonLabel, SOURCE_KIND_LABEL } from "../labels";
import { LeadCallButton } from "./LeadCallButton";
import { LostSheet } from "./LostSheet";
import { SlaTimer } from "./SlaTimer";

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

/** One inbox card: SLA timer, source, service, price, date, area, returning badge + quick actions. */
export function LeadCard({
  lead,
  viewerId,
  canEdit,
  lostReasons,
  active,
}: {
  lead: LeadListItem;
  viewerId: string;
  canEdit: boolean;
  lostReasons: string[];
  active?: boolean;
}) {
  const [lostOpen, setLostOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const open = OPEN.has(lead.status);
  const mine = lead.assignedUserId === viewerId;
  const href = `/leads/${lead.id}`;

  const claim = async () => {
    setClaiming(true);
    const r = await claimLead({ leadId: lead.id });
    setClaiming(false);
    if (r.ok) toast.success("Claimed — it's yours");
    else toast.error(r.error);
  };

  const body = (
    <article
      className={cx(
        "list-card flex flex-col gap-2 px-4 py-3",
        active && "ring-2 ring-accent",
      )}
      aria-label={`Lead ${lead.name}`}
    >
      <div className="flex items-start gap-2">
        <Link
          href={href}
          transitionTypes={["nav-forward"]}
          className="min-w-0 flex-1 rounded-control focus-visible:outline-2"
        >
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-headline">{lead.name}</h3>
            {lead.isReturning && (
              <Repeat
                size={14}
                className="shrink-0 text-accent-text"
                aria-label="Returning customer"
              />
            )}
          </div>
          <p className="truncate text-subhead text-label-2">
            {[lead.service ?? "Service not given", lead.phoneDisplay]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Link>
        {open ? (
          <SlaTimer
            createdAt={lead.createdAt}
            respondedAt={lead.firstResponseAt}
          />
        ) : (
          <StatusPill
            kind="lead"
            status={lead.status}
            label={
              lead.status === "lost" && lead.lostReason
                ? `Lost · ${lostReasonLabel(lead.lostReason)}`
                : undefined
            }
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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
        {lead.isReturning && (
          <Pill tone="indigo" dot={false} size="sm">
            Returning
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
        {lead.quotedPriceCents != null && (
          <span className="text-footnote font-semibold">
            <MoneyText cents={lead.quotedPriceCents} />
          </span>
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
              lead.inServiceArea === false
                ? "text-[var(--sys-red)]"
                : "text-label-2",
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
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {lead.hasPhone && <LeadCallButton leadId={lead.id} />}
          {lead.customerId ? (
            <Button
              variant="gray"
              size="sm"
              href={`/messages/${lead.customerId}`}
              icon={<MessageSquare size={16} aria-hidden />}
            >
              Text
            </Button>
          ) : null}
          {!lead.assignedUserId ? (
            <Button
              variant="gray"
              size="sm"
              onClick={claim}
              loading={claiming}
              icon={<UserCheck size={16} aria-hidden />}
            >
              Claim
            </Button>
          ) : (
            <span className="ml-auto text-footnote text-label-2">
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
      <LostSheet
        leadId={lead.id}
        reasons={lostReasons}
        open={lostOpen}
        onOpenChange={setLostOpen}
      />
    </>
  );
}
