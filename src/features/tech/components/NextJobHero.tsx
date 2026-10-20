import "server-only";
import { Clock, MapPin, MessageCircle, Navigation } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import {
  auditCustomerView,
  getCustomerBrief,
  getPropertyBrief,
} from "@/features/customers/api";
import { navigateHref } from "@/features/customers/normalize";
import type { JobListItem } from "@/features/jobs/types";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { formatInTz, formatTimeRange } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Avatar } from "@/ui/components/Avatar";
import { Card } from "@/ui/components/Card";
import { IconButton } from "@/ui/components/IconButton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import { CallButton, HeroActions } from "./islands";

/**
 * Uber-style current / next job card on the tech's Today (DESIGN.md §7.1): live
 * status, title (M3 morph into the job hero), window, customer and address, ONE
 * primary for the next step, and call / text / navigate as round icon buttons.
 * Contact masking follows the customer briefs (SPEC §4.2): outside the contact
 * window there is no call button and no navigation link.
 */
export async function NextJobHero({
  job,
  user,
  tz,
  active,
  muted,
}: {
  job: JobListItem;
  user: SessionUser;
  tz: string;
  /** On the way / on site / working (vs. "next up"). */
  active: boolean;
  /** Not clocked in: Clock in is the page's primary, so this button steps down. */
  muted?: boolean;
}) {
  const [brief, prop, h] = await Promise.all([
    getCustomerBrief(job.customerId, user, { jobId: job.id }),
    getPropertyBrief(job.propertyId, user, { jobId: job.id }),
    headers(),
  ]);
  if (brief) await auditCustomerView(user, brief.id, job.id);
  const nav =
    prop && !prop.masked ? navigateHref(prop, h.get("user-agent")) : null;
  const canText =
    !!brief &&
    user.perms.has("messages.send") &&
    !brief.flags.doNotText &&
    !brief.flags.doNotContact &&
    brief.smsStatus !== "opted_out";
  const phoneText = brief?.contactRevealed
    ? brief.phone
      ? formatPhoneDisplay(brief.phone)
      : null
    : (brief?.phoneMasked ?? null);
  const name = brief?.displayName ?? job.customerName;
  const street = prop?.addressShort ?? job.addressShort;
  const cityLine = prop
    ? `${prop.city}, ${prop.state} ${prop.zip}`
    : (job.city ?? "");
  const window = job.windowStart
    ? job.windowEnd
      ? formatTimeRange(job.windowStart, job.windowEnd, tz)
      : formatInTz(job.windowStart, tz, { hour: "numeric", minute: "2-digit" })
    : null;
  const href = `/jobs/${job.id}`;

  return (
    <Card
      as="section"
      padding="none"
      aria-label={active ? "Current job" : "Next job"}
      className="overflow-hidden"
    >
      {/* A soft accent wash on top: the one card that is "the trip". */}
      <div className="flex flex-col gap-3 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_9%,transparent),transparent_75%)] p-[var(--card-pad)] pb-0">
        <div className="flex items-center gap-2">
          <StatusPill kind="job" status={job.status} />
          {job.priority !== "normal" && (
            <Pill tone={job.priority === "emergency" ? "red" : "orange"}>
              {job.priority === "emergency" ? "Emergency" : "Urgent"}
            </Pill>
          )}
          <span className="num ml-auto text-footnote text-label-2">
            {active ? "Now" : "Next up"} · {job.number}
          </span>
        </div>
        <Link
          href={href}
          prefetch
          transitionTypes={["nav-forward"]}
          className="flex flex-col gap-1 rounded-control outline-offset-4"
        >
          <Morph name={`job-${job.id}-title`}>
            <h2 className="inline-block text-title2 font-bold leading-tight text-label">
              {job.title}
            </h2>
          </Morph>
          {window && (
            <span className="num flex items-center gap-1.5 text-subhead text-label-2">
              <Clock size={15} aria-hidden className="shrink-0" />
              {window}
              {job.serviceTypeName ? ` · ${job.serviceTypeName}` : ""}
            </span>
          )}
        </Link>
      </div>

      <div className="flex flex-col gap-3 p-[var(--card-pad)]">
        <div className="flex items-center gap-3 rounded-[16px] bg-card-2 p-3">
          <Avatar name={name} seed={job.customerId} size={44} />
          <div className="min-w-0 flex-1">
            <Link
              href={`/customers/${job.customerId}`}
              transitionTypes={["nav-forward"]}
              className="block truncate text-headline text-label"
            >
              {name}
            </Link>
            <p className="flex min-w-0 items-center gap-1 text-subhead text-label-2">
              <MapPin size={14} aria-hidden className="shrink-0" />
              <span className="truncate">
                {street}
                {cityLine ? `, ${cityLine}` : ""}
              </span>
            </p>
            {phoneText && (
              <p className="num truncate text-footnote text-label-3">
                {phoneText}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <HeroActions
              jobId={job.id}
              status={job.status}
              customerFirstName={
                brief?.firstName ?? job.customerName.split(" ")[0] ?? null
              }
              muted={muted}
            />
          </div>
          {brief?.phoneMasked && brief.contactRevealed && (
            <CallButton
              customerId={brief.id}
              jobId={job.id}
              variant="icon"
              size={44}
            />
          )}
          {canText && brief && (
            <IconButton
              label={`Text ${brief.firstName ?? name}`}
              variant="secondary"
              href={`/messages/${brief.id}`}
              transition="push"
            >
              <MessageCircle size={20} aria-hidden />
            </IconButton>
          )}
          {nav && (
            <IconButton
              label="Navigate"
              variant="secondary"
              href={nav}
              external
            >
              <Navigation size={20} aria-hidden />
            </IconButton>
          )}
        </div>
        {prop?.masked && (
          <p className="text-footnote text-label-2">
            The full address and phone show from 2 h before your visit.
          </p>
        )}
      </div>
    </Card>
  );
}
