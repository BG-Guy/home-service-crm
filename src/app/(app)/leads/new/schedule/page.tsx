import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { DayAvailability } from "@/features/jobs/availability/types";
import {
  NO_JOB_TYPE,
  serviceTypeFor,
  valueFromType,
} from "@/features/jobs/components/job-type-choice";
import { listServiceTypeOptions } from "@/features/jobs/service-types";
import {
  confirmationLabel,
  dayReason,
  pickInitialDay,
} from "@/features/leads/booking-labels";
import {
  getBookingDone,
  getScheduleLead,
  loadBookingDays,
} from "@/features/leads/booking-queries";
import {
  BookingFlow,
  type BookingLead,
} from "@/features/leads/components/booking/BookingFlow";
import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import type { DoneView } from "@/features/leads/components/booking/DoneCard";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { addDaysToKey, dateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Card } from "@/ui/components/Card";
import { EmptyState } from "@/ui/components/EmptyState";
import type { BackTarget } from "@/ui/components/NavBar";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Book" };

/** Days the week strip covers from today (more when they asked for a later day). */
const STRIP_DAYS = 28;
const HORIZON_DAYS = 59;

/**
 * Booking flow, What + When, for any saved lead (phone, website, Google,
 * Thumbtack…): `/leads/new/schedule?leadId=<id>` (`&from=call|lead` picks the
 * back link, `&step=what` opens on What). A booked lead shows its Done screen.
 */
export default async function BookLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string; from?: string; step?: string }>;
}) {
  const user = await requireUser(["leads.convert", "jobs.create"]);
  if (!(await isEnabled("leads"))) notFound();
  const sp = await searchParams;
  const from: "call" | "lead" | null =
    sp.from === "call" || sp.from === "lead" ? sp.from : null;
  const lead = await getScheduleLead(sp.leadId, user);
  if (!lead) notFound();

  const canView = user.perms.has("leads.view");
  const whoHref =
    user.perms.has("leads.edit") &&
    lead.status !== "spam" &&
    lead.status !== "booked"
      ? `/leads/new?leadId=${lead.leadId}`
      : null;
  const back: BackTarget =
    from === "call" && whoHref
      ? { href: whoHref, label: "Who" }
      : from === "lead"
        ? { href: `/leads/${lead.leadId}`, label: "Lead" }
        : canView
          ? { href: "/leads", label: "Leads" }
          : { href: "/today", label: "Today" };
  const nextHref = from === "call" || !canView ? "/leads/new" : "/leads";
  const view: BookingLead = {
    leadId: lead.leadId,
    name: lead.name,
    phone: lead.phone,
    addressLine: lead.addressLine,
    zip: lead.address?.zip ?? null,
    serviceText: lead.serviceText,
    notes: lead.notes ?? "",
    preferredDate: lead.preferredDate,
    preferredWindow: lead.preferredWindow,
  };
  // Same tree for every state, so the refresh that follows Book keeps the
  // flow's client state (its Done card) mounted.
  const shell = (title: string, to: BackTarget, body: ReactNode) => (
    <PageTransition>
      <NavBar title={title} back={to} />
      <Page className="pt-2">
        <div className="mx-auto w-full max-w-[1160px]">{body}</div>
      </Page>
    </PageTransition>
  );
  const flowBase = {
    lead: view,
    from,
    whoHref,
    canAssign: user.perms.has("jobs.assign"),
    nextHref,
  };

  // Booked: the Done screen (a reload, or the server refresh right after Book).
  if (lead.jobId && !lead.jobCancelled) {
    const b = await getBookingDone(lead.jobId);
    if (b) {
      const done: DoneView = {
        jobId: b.jobId,
        number: b.number,
        customerName: b.customerName,
        serviceName: b.serviceName,
        date: b.date,
        start: b.start,
        end: b.end,
        techName: b.techName,
        status: confirmationLabel(b),
      };
      return shell(
        "Booked",
        canView ? { href: "/leads", label: "Leads" } : back,
        <BookingFlow
          {...flowBase}
          types={[]}
          initialType={NO_JOB_TYPE}
          initialPriority="normal"
          initialAfterHours={false}
          startStep="when"
          days={[]}
          firstDay={null}
          today=""
          rangeTo=""
          maxMiles={0}
          afterHoursBooking={false}
          booked={done}
        />,
      );
    }
  }

  const blocked = (title: string, message: string, action: ReactNode) =>
    shell(
      "Book",
      back,
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5">
        <BookingSteps
          current={1}
          hrefs={whoHref ? { 1: whoHref } : undefined}
        />
        <Card>
          <EmptyState title={title} message={message} action={action} />
        </Card>
      </div>,
    );
  const openLead = (
    <Button href={`/leads/${lead.leadId}`} variant="secondary">
      Open the lead
    </Button>
  );
  if (lead.status === "booked")
    return blocked(
      "Its job was cancelled",
      "Reopen the lead first, then book it again.",
      openLead,
    );
  if (lead.status === "spam")
    return blocked(
      "This lead is marked spam",
      "Mark it as not spam on the lead first, then book it.",
      openLead,
    );
  if (!lead.propertyId && !lead.address)
    return blocked(
      "Add a service address first",
      "This lead has no address yet, so there's nothing to book against.",
      whoHref ? (
        <Button href={whoHref} variant="secondary">
          Add the address
        </Button>
      ) : (
        openLead
      ),
    );

  const [types, tz, settings] = await Promise.all([
    listServiceTypeOptions(),
    getCompanyTimezone(),
    getSettings(),
  ]);
  const today = dateKey(new Date(), tz);
  const horizon = addDaysToKey(today, HORIZON_DAYS);
  const asked =
    lead.preferredDate && lead.preferredDate >= today
      ? lead.preferredDate
      : null;
  let rangeTo = addDaysToKey(today, STRIP_DAYS - 1);
  if (asked && asked > rangeTo) {
    const past = addDaysToKey(asked, 3);
    rangeTo = past > horizon ? horizon : past;
  }
  const initialType = valueFromType(
    types,
    lead.serviceTypeId,
    lead.kind,
    lead.serviceText,
  );
  let days: DayAvailability[] = [];
  let firstDay: DayAvailability | null = null;
  if (initialType.kind) {
    const job = {
      kind: initialType.kind,
      serviceTypeId: serviceTypeFor(types, initialType),
      types,
    };
    days = await loadBookingDays(lead, job, { from: today, to: rangeTo });
    const first = pickInitialDay(
      days.filter(
        (d) =>
          dayReason(d) !== "closed" || d.date === asked || d.date === today,
      ),
      asked,
    );
    if (first)
      [firstDay = null] = await loadBookingDays(lead, job, {
        from: first,
        to: first,
        withWindows: true,
      });
  }
  const startStep =
    sp.step === "what" || !initialType.kind ? "what" : ("when" as const);

  return shell(
    "Book",
    back,
    <BookingFlow
      {...flowBase}
      types={types}
      initialType={initialType}
      initialPriority={lead.priority}
      initialAfterHours={lead.afterHours}
      startStep={startStep}
      days={days}
      firstDay={firstDay}
      today={today}
      rangeTo={rangeTo}
      maxMiles={settings.jobs.max_extra_miles}
      afterHoursBooking={settings.jobs.after_hours_booking}
      booked={null}
    />,
  );
}
