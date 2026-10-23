"use client";

import {
  Briefcase,
  CalendarDays,
  Camera,
  ClipboardList,
  Clock,
  Copy,
  DollarSign,
  Hammer,
  MapPin,
  MessageSquare,
  Navigation,
  NotebookText,
  Phone,
  PhoneCall,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import type { JobKind } from "@/features/jobs/kinds";
import { KIND_LABEL } from "@/features/jobs/kinds";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { MoneyText } from "@/ui/components/MoneyText";
import { Skeleton } from "@/ui/components/Skeleton";
import { cx } from "@/ui/cx";
import { type Tone, toneStyle } from "@/ui/tone";
import type { LeadBoxData, LeadCardData } from "../contracts";
import {
  lostReasonLabel,
  OUTCOME_LABEL,
  slaTone,
  spamSignals,
} from "../labels";
import { isOpenStatus, STATUS_WORD } from "../rules";
import { CallOutcomeFlow } from "./CallOutcomeFlow";
import { LeadActionGroups } from "./LeadActionGroups";
import { LeadCallButton } from "./LeadCallButton";
import { useLeadEnv } from "./lead-env";
import {
  copyText,
  directionsHref,
  textHref,
  useIsApple,
  useNow,
  waitLabel,
} from "./lead-links";
import { MiniMap } from "./MiniMap";
import { usePendingCallLead } from "./pending-call";
import { useLeadChanges } from "./use-lead-changes";

const PhotoGrid = dynamic(
  () => import("@/ui/components/PhotoGrid").then((m) => m.PhotoGrid),
  { ssr: false },
);

/** The card's data: the box at once, the rest when the loader answers. */
export type CardLead = LeadBoxData & Partial<LeadCardData>;

const KIND_ICON: Record<JobKind, ReactNode> = {
  estimate: <ClipboardList size={16} aria-hidden />,
  service: <Wrench size={16} aria-hidden />,
  project: <Hammer size={16} aria-hidden />,
};

const STATUS_TONE: Record<string, Tone> = {
  new: "blue",
  contacted: "indigo",
  qualified: "purple",
  booked: "green",
  lost: "gray",
  spam: "gray",
};

function TagPill({
  tone,
  live,
  children,
}: {
  tone?: Tone;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill px-3 text-subhead font-semibold",
        tone ? "tint-bg tint-fg" : "bg-fill text-label",
      )}
      style={tone ? toneStyle(tone) : undefined}
    >
      {tone && (
        <span
          aria-hidden
          className={cx("size-2 shrink-0 rounded-full", live && "live-dot")}
          style={{ background: "var(--tone)" }}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The status pill of the TL;DR: the wait while nobody has answered. */
function StatusTag({ lead, now }: { lead: CardLead; now: number | null }) {
  if (lead.flags.check)
    return <TagPill tone="orange">Check · score {lead.spamScore}</TagPill>;
  if (lead.status === "new" && !lead.respondedAt) {
    const ms = now ? now - Date.parse(lead.slaStart) : null;
    return (
      <TagPill tone={slaTone((ms ?? 0) / 60_000)} live>
        {ms == null ? "No reply yet" : `No reply in ${waitLabel(ms)}`}
      </TagPill>
    );
  }
  if (lead.status === "lost")
    return (
      <TagPill tone="gray">
        Lost{lead.lostReason ? ` · ${lostReasonLabel(lead.lostReason)}` : ""}
      </TagPill>
    );
  return (
    <TagPill tone={STATUS_TONE[lead.status]}>
      {lead.status === "new" ? "New lead" : STATUS_WORD[lead.status]}
    </TagPill>
  );
}

function InfoBox({
  icon,
  label,
  wide,
  children,
  className,
}: {
  icon: ReactNode;
  label: string;
  wide?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        "flex min-w-0 flex-col gap-2 rounded-card bg-card p-3.5 shadow-card",
        wide && "col-span-2",
        className,
      )}
    >
      <h3 className="flex items-center gap-1.5 text-footnote font-semibold text-label-2 [&>svg]:size-[15px] [&>svg]:shrink-0">
        {icon}
        {label}
      </h3>
      {children}
    </section>
  );
}

function ago(iso: string, now: number | null): string {
  if (!now) return "";
  const ms = now - Date.parse(iso);
  return ms < 60_000 ? "just now" : `${waitLabel(ms)} ago`;
}

const CONTACT_WORD: Record<string, string> = {
  connected: "Talked",
  no_answer: "No answer",
  voicemail: "Left voicemail",
  busy: "Busy",
  wrong_number: "Wrong number",
};

/**
 * The lead card (leads-flow item 3): the TL;DR (name, status, job type, street,
 * when), then boxes (Phone, Address, Wants, Quote & source, Last contact, Notes,
 * Photos) and the action groups. Used by the sheet and by /leads/[id].
 */
export function LeadCardBody({
  lead,
  loading,
}: {
  lead: CardLead;
  /** Only the box is known so far (the detail boxes shimmer). */
  loading?: boolean;
  /** Where it sits (the sheet, or the /leads/[id] page); same layout. */
  variant: "sheet" | "page";
}) {
  const env = useLeadEnv();
  const now = useNow();
  const apple = useIsApple();
  const pending = usePendingCallLead() === lead.id;
  const [logOpen, setLogOpen] = useState(false);
  const [logArmed, setLogArmed] = useState(false);
  const open = isOpenStatus(lead.status);
  const nav = directionsHref(lead, apple);
  const text = textHref(lead);
  const where =
    lead.addressText ??
    ([lead.street, lead.city].filter(Boolean).join(", ") || null);
  const service =
    lead.serviceName?.trim() || (lead.kind ? KIND_LABEL[lead.kind] : null);
  const copy = async (what: string, value: string) => {
    const ok = await copyText(value);
    env.notify(
      ok
        ? { title: `Copied: ${value}`, tone: "success" }
        : { title: `Couldn't copy the ${what}`, tone: "error" },
    );
  };
  const waited =
    lead.status === "new" && !lead.respondedAt
      ? now
        ? `waiting ${waitLabel(now - Date.parse(lead.slaStart))}`
        : null
      : lead.respondedAt && open
        ? `answered in ${waitLabel(Date.parse(lead.respondedAt) - Date.parse(lead.slaStart))}`
        : null;
  const shimmer = (w: string) => <Skeleton height={14} width={w} />;

  return (
    <div className="flex flex-col gap-[var(--section-gap,24px)]">
      {/* TL;DR */}
      <header className="flex min-w-0 flex-col gap-2.5">
        {/* The page's h1 is its nav bar title; the sheet is named by its label. */}
        <h2 className="text-title1 text-label [overflow-wrap:anywhere]">
          {lead.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          <StatusTag lead={lead} now={now} />
          {service && (
            <span className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill bg-fill px-3 text-subhead font-semibold text-label">
              {lead.kind && KIND_ICON[lead.kind]}
              <span className="truncate">{service}</span>
            </span>
          )}
        </div>
        <p className="flex items-start gap-2 text-callout text-label-2">
          <MapPin size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span className={cx(!where && "text-label-3")}>
            {where ?? "No address yet"}
            {lead.flags.outsideArea && (
              <span className="text-danger"> · outside your area</span>
            )}
          </span>
        </p>
        {(lead.when || waited) && (
          <p className="flex items-start gap-2 text-callout text-label-2">
            <Clock size={18} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {[
                lead.when
                  ? `${lead.when.kind === "arrival" ? "Arrives " : ""}${lead.when.label}`
                  : null,
                waited,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        )}
      </header>

      {lead.flags.check && (
        <Banner
          tone="warning"
          title={`Check this lead (spam score ${lead.spamScore})`}
        >
          {lead.spamReason ? `Signals: ${spamSignals(lead.spamReason)}. ` : ""}
          No customer yet. Looks legit moves it to the inbox.
        </Banner>
      )}
      {lead.status === "spam" && (
        <Banner tone="info" title="Marked as spam">
          {`Reason: ${spamSignals(lead.spamReason) || "marked by hand"}. The sender saw a normal thank-you.`}
        </Banner>
      )}

      {/* The boxes */}
      <div className="grid grid-cols-2 gap-3">
        <InfoBox icon={<Phone />} label="Phone">
          <p
            className={cx(
              "num truncate text-headline",
              !lead.phone && "text-label-3",
            )}
          >
            {lead.phone ?? "No phone"}
          </p>
          {lead.email && (
            <p className="-mt-1.5 truncate text-footnote text-label-2">
              {lead.email}
            </p>
          )}
          <div className="mt-auto flex gap-1.5 pt-1">
            {lead.phoneE164 && env.can.edit ? (
              <LeadCallButton
                leadId={lead.id}
                name={lead.name}
                render={({ onClick, busy }) => (
                  <IconButton
                    label={`Call ${lead.name}`}
                    variant="primary"
                    size={40}
                    onClick={onClick}
                    disabled={busy}
                  >
                    <Phone size={19} />
                  </IconButton>
                )}
              />
            ) : null}
            {text && (
              <IconButton
                label={`Text ${lead.name}`}
                variant="secondary"
                size={40}
                href={text}
                transition={lead.customerId ? "push" : "none"}
              >
                <MessageSquare size={19} />
              </IconButton>
            )}
            {lead.phone && (
              <IconButton
                label="Copy the phone number"
                variant="secondary"
                size={40}
                onClick={() =>
                  void copy("phone number", formatPhoneDisplay(lead.phone))
                }
              >
                <Copy size={18} />
              </IconButton>
            )}
          </div>
        </InfoBox>

        <InfoBox icon={<MapPin />} label="Address">
          {lead.street && (
            <p className="-mb-0.5 truncate text-subhead font-semibold">
              {lead.street}
            </p>
          )}
          <MiniMap
            lat={lead.lat}
            lng={lead.lng}
            tileUrl={env.tileUrl}
            label={where ? `Map of ${where}` : "No address yet"}
          />
          <div className="flex gap-1.5 pt-1">
            {nav && (
              <IconButton
                label="Directions"
                variant="primary"
                size={40}
                href={nav}
                external
              >
                <Navigation size={19} />
              </IconButton>
            )}
            {where && (
              <IconButton
                label="Copy the address"
                variant="secondary"
                size={40}
                onClick={() => void copy("address", where)}
              >
                <Copy size={18} />
              </IconButton>
            )}
          </div>
        </InfoBox>

        <InfoBox
          icon={
            lead.when?.kind === "arrival" ? <Briefcase /> : <CalendarDays />
          }
          label={lead.when?.kind === "arrival" ? "Arrives" : "Wants"}
        >
          <p
            className={cx(
              "text-headline [overflow-wrap:anywhere]",
              !lead.when && "text-label-3",
            )}
          >
            {lead.when?.label ?? "No day given"}
          </p>
          {(lead.priority === "urgent" ||
            lead.priority === "emergency" ||
            lead.afterHours) && (
            <p className="flex flex-wrap gap-1.5">
              {(lead.priority === "urgent" ||
                lead.priority === "emergency") && (
                <span
                  className="tint-bg rounded-pill px-2 text-caption font-semibold text-danger"
                  style={toneStyle("red")}
                >
                  {lead.priority === "emergency" ? "Emergency" : "Urgent"}
                </span>
              )}
              {lead.afterHours && (
                <span className="rounded-pill bg-fill px-2 text-caption font-semibold text-label-2">
                  After hours
                </span>
              )}
            </p>
          )}
          {lead.job && lead.status === "booked" && (
            <p className="text-footnote text-label-2">
              Job {lead.job.number ?? ""}
              {lead.job.cancelled ? " · cancelled" : ""}
            </p>
          )}
        </InfoBox>

        <InfoBox icon={<DollarSign />} label="Quote">
          <p
            className={cx(
              "text-headline",
              lead.quoteCents == null && "text-label-3",
            )}
          >
            {lead.quoteCents == null ? (
              "No quote yet"
            ) : (
              <MoneyText cents={lead.quoteCents} />
            )}
          </p>
          <p className="truncate text-footnote text-label-2">
            {lead.source ?? "Source not known"}
          </p>
        </InfoBox>

        <InfoBox icon={<PhoneCall />} label="Last contact">
          {loading ? (
            <>
              {shimmer("70%")}
              {shimmer("45%")}
            </>
          ) : lead.lastContact ? (
            <>
              <p className="text-headline">
                {lead.lastContact.channel === "call"
                  ? (CONTACT_WORD[lead.lastContact.outcome ?? ""] ??
                    OUTCOME_LABEL[lead.lastContact.outcome ?? ""] ??
                    "Called")
                  : lead.lastContact.channel === "email"
                    ? "Emailed"
                    : "Texted"}
              </p>
              <p className="truncate text-footnote text-label-2">
                {[ago(lead.lastContact.at, now), lead.lastContact.byName]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : (
            <p className="text-headline text-label-3">Not yet</p>
          )}
          {pending && env.can.edit && (
            <Button
              variant="tinted"
              size="sm"
              className="mt-auto self-start"
              onClick={() => {
                setLogArmed(true);
                setLogOpen(true);
              }}
            >
              Log the call
            </Button>
          )}
        </InfoBox>

        <InfoBox
          icon={<NotebookText />}
          label="Notes"
          wide={(lead.notes?.length ?? 0) > 90}
        >
          {loading ? (
            <>
              {shimmer("90%")}
              {shimmer("60%")}
            </>
          ) : (
            <p
              className={cx(
                "line-clamp-6 whitespace-pre-wrap text-subhead [overflow-wrap:anywhere]",
                !lead.notes && "text-label-3",
              )}
            >
              {lead.notes ?? "No notes"}
            </p>
          )}
        </InfoBox>

        {(lead.photos?.length ?? 0) > 0 && (
          <InfoBox icon={<Camera />} label="Photos" wide>
            <PhotoGrid
              photos={lead.photos ?? []}
              layout="strip"
              historyKey="lead-photo"
            />
          </InfoBox>
        )}
      </div>

      <LeadActionGroups lead={lead} />

      {logArmed && (
        <CallOutcomeFlow
          leadId={lead.id}
          name={lead.name}
          open={logOpen}
          onOpenChange={setLogOpen}
        />
      )}
    </div>
  );
}

/**
 * The booking bar: what they want and the one main button. Open leads → Book
 * (`/leads/new/schedule?leadId=`); closed leads → their way back (Reopen, Not
 * spam) or Open job. In the sheet it's the sticky footer; on the page a BottomBar.
 */
export function LeadBookingBar({
  lead,
  variant,
}: {
  lead: CardLead;
  variant: "sheet" | "page";
}) {
  const env = useLeadEnv();
  const changes = useLeadChanges();
  const service =
    lead.serviceName?.trim() ||
    (lead.kind ? KIND_LABEL[lead.kind] : "Service not given");
  let title: ReactNode = (
    <>
      {service}
      {lead.quoteCents != null && (
        <>
          {" · "}
          <MoneyText cents={lead.quoteCents} />
        </>
      )}
    </>
  );
  let subtitle: ReactNode = lead.when?.label ?? "No day given yet";
  let action: ReactNode = null;
  const back = lead.previousStatus ? STATUS_WORD[lead.previousStatus] : null;
  if (isOpenStatus(lead.status)) {
    if (env.can.convert)
      action = (
        <Button
          size="lg"
          href={`/leads/new/schedule?leadId=${lead.id}`}
          transition="push"
        >
          Book
        </Button>
      );
  } else if (lead.status === "booked") {
    title = `Booked · ${service}`;
    subtitle =
      lead.when?.label ?? (lead.job?.number ? `Job ${lead.job.number}` : "");
    if (lead.job?.cancelled && env.can.edit) {
      subtitle = "The job was cancelled";
      action = (
        <Button
          size="lg"
          icon={<RotateCcw size={18} aria-hidden />}
          loading={changes.busy === "reopen"}
          onClick={() => void changes.reopen(lead.id)}
        >
          Reopen
        </Button>
      );
    } else if (lead.job)
      action = (
        <Button
          size="lg"
          href={`/jobs/${lead.job.id}`}
          transition="push"
          icon={<Briefcase size={18} aria-hidden />}
        >
          Open job
        </Button>
      );
  } else if (lead.status === "lost") {
    title = `Lost${lead.lostReason ? ` · ${lostReasonLabel(lead.lostReason)}` : ""}`;
    subtitle = back
      ? `Reopen puts it back to ${back}`
      : "Reopen puts it back where it was";
    if (env.can.edit)
      action = (
        <Button
          size="lg"
          icon={<RotateCcw size={18} aria-hidden />}
          loading={changes.busy === "reopen"}
          onClick={() => void changes.reopen(lead.id)}
        >
          Reopen
        </Button>
      );
  } else if (lead.status === "spam") {
    title = "Spam";
    subtitle = back ? `Not spam puts it back to ${back}` : service;
    if (env.can.edit)
      action = (
        <Button
          size="lg"
          icon={<ShieldCheck size={18} aria-hidden />}
          loading={changes.busy === "not_spam"}
          onClick={() => void changes.notSpam(lead.id, false)}
        >
          Not spam
        </Button>
      );
  }
  if (variant === "page")
    return (
      <BottomBar
        label="Lead"
        summary={<BarSummary title={title} subtitle={subtitle} />}
        action={action}
      />
    );
  return (
    <div className="flex min-h-[52px] items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="num truncate text-headline">{title}</div>
        <div className="truncate text-footnote text-label-2">{subtitle}</div>
      </div>
      {action}
    </div>
  );
}
