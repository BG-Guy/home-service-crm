"use client";

import { MapPin } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import { JobTypePicker } from "@/features/jobs/components/JobTypePicker";
import {
  choiceLabel,
  type JobTypeRow,
  type JobTypeValue,
  kindDuration,
  serviceTypeFor,
  visitLength,
} from "@/features/jobs/components/job-type-choice";
import { KIND_LABEL } from "@/features/jobs/kinds";
import { DetailLayout } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import {
  bookLead,
  fetchBookingDay,
  fetchBookingDays,
} from "../../booking-actions";
import {
  barWhen,
  bestWindowStart,
  dayLabel,
  dayReason,
  nextOpenDay,
  pickInitialDay,
  reasonText,
  requestedDay,
  requestedLabel,
} from "../../booking-labels";
import type { LeadPriority } from "../../contracts";
import { BookingSteps } from "./BookingSteps";
import { DoneCard, type DoneView } from "./DoneCard";
import { useKeepFocusVisible } from "./keep-focus-visible";
import { UrgencyFields } from "./UrgencyFields";
import { WeekStrip } from "./WeekStrip";
import { WindowGrid } from "./WindowGrid";

// What + When of the booking flow, for any saved lead
// (/leads/new/schedule?leadId=). What = the three job type cards with the trade's
// jobs as chips, urgency, after-hours and the customer's notes; When = a week strip
// from today (the asked-for day preselected) and the day's 2-hour arrival windows.
// No tech step: Book creates the job with its window and the Assign hub picks the
// tech. Done shows right here, from what was just booked (no round trip), and the
// URL becomes /leads/new/done?jobId= so a reload lands on the same screen.

export interface BookingLead {
  leadId: string;
  name: string;
  phone: string | null;
  addressLine: string | null;
  zip: string | null;
  /** What the lead typed, when it has no job type. */
  serviceText: string | null;
  notes: string;
  preferredDate: string | null;
  preferredWindow: string | null;
}

type Step = "what" | "when";
const PRIORITY_WORD: Record<LeadPriority, string | null> = {
  normal: null,
  urgent: "Urgent",
  emergency: "Emergency",
};
const kindName = (k: keyof typeof KIND_LABEL) => KIND_LABEL[k];

/** The strip skips closed days (weekends nobody works), but never today or the asked-for day. */
const visibleDays = (
  days: readonly DayAvailability[],
  asked: string | null,
  today: string,
) =>
  days.filter(
    (d) => dayReason(d) !== "closed" || d.date === asked || d.date === today,
  );

const defaultStart = (d: DayAvailability | null | undefined) =>
  d
    ? (bestWindowStart(d.windows) ??
      d.windows.find((w) => w.status === "open")?.start ??
      null)
    : null;

export function BookingFlow({
  lead,
  types,
  initialType,
  initialPriority,
  initialAfterHours,
  startStep,
  days: initialDays,
  firstDay,
  today,
  rangeTo,
  maxMiles,
  afterHoursBooking,
  from,
  whoHref,
  booked: bookedOnServer,
  canAssign,
  nextHref,
}: {
  lead: BookingLead;
  types: JobTypeRow[];
  initialType: JobTypeValue;
  initialPriority: LeadPriority;
  initialAfterHours: boolean;
  startStep: Step;
  /** The strip for `initialType` (empty when no job type yet). */
  days: DayAvailability[];
  /** The preselected day, with its windows. */
  firstDay: DayAvailability | null;
  today: string;
  rangeTo: string;
  maxMiles: number;
  /** Settings → Scheduling: after-hours windows offered. */
  afterHoursBooking: boolean;
  from: "call" | "lead" | null;
  /** "Who" (edit the lead's details), when allowed. */
  whoHref: string | null;
  /** Already booked (a reload, or the refresh right after Book). */
  booked: DoneView | null;
  canAssign: boolean;
  nextHref: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useKeepFocusVisible(rootRef);
  const keyOf = useCallback(
    (v: JobTypeValue) => `${v.kind ?? ""}|${serviceTypeFor(types, v) ?? ""}`,
    [types],
  );
  const [step, setStep] = useState<Step>(startStep);
  const [moved, setMoved] = useState(false);
  const [type, setType] = useState<JobTypeValue>(initialType);
  const [priority, setPriority] = useState<LeadPriority>(initialPriority);
  const [afterHours, setAfterHours] = useState(initialAfterHours);
  const [notes, setNotes] = useState(lead.notes);
  const [strip, setStrip] = useState<{
    key: string;
    days: DayAvailability[];
  } | null>(
    initialType.kind ? { key: keyOf(initialType), days: initialDays } : null,
  );
  const [stripLoading, setStripLoading] = useState(false);
  const [date, setDate] = useState<string | null>(firstDay?.date ?? null);
  const [cache, setCache] = useState<Record<string, DayAvailability>>(() =>
    firstDay && initialType.kind
      ? { [`${keyOf(initialType)}|${firstDay.date}`]: firstDay }
      : {},
  );
  const [loadingDay, setLoadingDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(defaultStart(firstDay));
  const [booked, setBooked] = useState<DoneView | null>(bookedOnServer);
  const [pending, startBook] = useTransition();
  const clientId = useRef(crypto.randomUUID());
  const inflight = useRef(new Map<string, Promise<DayAvailability | null>>());
  const dateRef = useRef(date);
  dateRef.current = date;
  const pushed = useRef(0);
  // Back/forward into When after the job type changed: reload the strip for it.
  const toWhen = useRef<() => void>(() => {});

  // The server's Done (after the refresh that follows Book) replaces ours.
  useEffect(() => {
    if (bookedOnServer) setBooked(bookedOnServer);
  }, [bookedOnServer]);

  // Booked: the address bar becomes the Done screen's, so a reload lands there.
  useEffect(() => {
    if (!booked) return;
    const url = `/leads/new/done?jobId=${booked.jobId}${from ? `&from=${from}` : ""}`;
    if (`${location.pathname}${location.search}` !== url)
      window.history.replaceState(null, "", url);
  }, [booked, from]);

  // Back / forward between What and When (each step change is a history entry).
  useEffect(() => {
    const onPop = () => {
      pushed.current = Math.max(0, pushed.current - 1);
      const s = new URLSearchParams(location.search).get("step");
      const next = s === "what" || s === "when" ? s : startStep;
      setStep(next);
      if (next === "when") toWhen.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [startStep]);

  const stripKey = strip?.key ?? null;
  const day = date && stripKey ? (cache[`${stripKey}|${date}`] ?? null) : null;
  const win: WindowSlot | null =
    day?.windows.find((w) => w.start === start && w.status === "open") ?? null;
  const choice = choiceLabel(types, type, kindName);
  const minutes = type.kind
    ? kindDuration(types, type.kind, serviceTypeFor(types, type))
    : null;
  const asked = requestedLabel(lead.preferredDate, lead.preferredWindow, today);
  const askedDay = requestedDay(
    lead.preferredDate,
    lead.preferredWindow,
    today,
  );

  const loadDay = useCallback(
    (d: string, key: string, v: JobTypeValue, pick: boolean, fresh = false) => {
      const ck = `${key}|${d}`;
      const apply = (got: DayAvailability | null) => {
        if (pick && dateRef.current === d) setStart(defaultStart(got));
      };
      const have = fresh ? null : cache[ck];
      if (have) return apply(have);
      let p = inflight.current.get(ck);
      if (!p) {
        if (!v.kind) return;
        p = fetchBookingDay({
          leadId: lead.leadId,
          kind: v.kind,
          serviceTypeId: serviceTypeFor(types, v),
          date: d,
        })
          .then((got) => {
            if (got) setCache((c) => ({ ...c, [ck]: got }));
            return got;
          })
          .catch(() => null)
          .finally(() => inflight.current.delete(ck));
        inflight.current.set(ck, p);
      }
      if (pick) setLoadingDay(d);
      void p.then((got) => {
        if (pick) setLoadingDay((cur) => (cur === d ? null : cur));
        apply(got);
      });
    },
    [cache, lead.leadId, types],
  );

  const selectDay = (d: string) => {
    if (!stripKey) return;
    setDate(d);
    dateRef.current = d;
    setStart(null);
    loadDay(d, stripKey, type, true);
  };

  /** Load the strip for the picked job type (length and skills change what's open). */
  const ensureStrip = (v: JobTypeValue) => {
    const key = keyOf(v);
    if (!v.kind || strip?.key === key) return;
    setStripLoading(true);
    setStrip(null);
    setDate(null);
    setStart(null);
    fetchBookingDays({
      leadId: lead.leadId,
      kind: v.kind,
      serviceTypeId: serviceTypeFor(types, v),
      from: today,
      to: rangeTo,
    })
      .then((got) => {
        setStrip({ key, days: got });
        const first = pickInitialDay(
          visibleDays(got, lead.preferredDate, today),
          lead.preferredDate,
        );
        setDate(first);
        dateRef.current = first;
        if (first) loadDay(first, key, v, true);
      })
      .catch(() => toast.error("Couldn't load the open days. Try again."))
      .finally(() => setStripLoading(false));
  };

  toWhen.current = () => ensureStrip(type);

  const go = (s: Step) => {
    if (s === step) return;
    setMoved(true);
    if (s === "what" && pushed.current > 0) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("step", s);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
    pushed.current += 1;
    setStep(s);
    if (s === "when") ensureStrip(type);
    window.scrollTo({ top: 0 });
  };

  const newJobHref = () => {
    const q = new URLSearchParams({ leadId: lead.leadId });
    if (date) q.set("date", date);
    const st = serviceTypeFor(types, type);
    if (st) q.set("serviceTypeId", st);
    if (priority !== "normal") q.set("priority", priority);
    if (afterHours) q.set("afterHours", "1");
    return `/jobs/new?${q.toString()}`;
  };

  const book = () => {
    if (!date || !win || !type.kind) return;
    const kind = type.kind;
    startBook(async () => {
      const r = await bookLead({
        leadId: lead.leadId,
        serviceTypeId: serviceTypeFor(types, type),
        kind,
        windowDate: date,
        windowStart: win.start,
        windowEnd: win.end,
        priority,
        // An after-hours window carries the after-hours price and pay rules.
        afterHours: afterHours || win.afterHours === true,
        customerNotes: notes,
        clientId: clientId.current,
      });
      if (!r.ok || !r.data) {
        toast.error(r.ok ? "Couldn't book it. Try again." : r.error);
        if (!r.ok && r.fieldErrors?.window && stripKey) {
          loadDay(date, stripKey, type, true, true);
        }
        return;
      }
      const job = types.find((t) => t.id === type.job);
      setBooked({
        jobId: r.data.jobId,
        number: r.data.number,
        customerName: lead.name,
        serviceName: job?.name ?? lead.serviceText ?? KIND_LABEL[kind],
        date,
        start: win.start,
        end: win.end,
        techName: null,
        status: {
          text: "Confirmation goes out when a tech is assigned",
          tone: "yellow",
          settled: true,
        },
      });
      window.scrollTo({ top: 0 });
    });
  };

  if (booked)
    return <DoneCard done={booked} canAssign={canAssign} nextHref={nextHref} />;

  // ---------------------------------------------------------------- What
  const what = (
    <div className="flex flex-col gap-5">
      {lead.serviceText && (
        <p className="rounded-tile bg-fill-2 px-4 py-3 text-subhead text-label-2">
          They asked for:{" "}
          <span className="font-semibold text-label">“{lead.serviceText}”</span>
        </p>
      )}
      <JobTypePicker
        types={types}
        value={type}
        onChange={(v) => {
          setType(v);
          const job = types.find((t) => t.id === v.job);
          if (job && /after[\s-]?hours/i.test(job.name)) setAfterHours(true);
        }}
        other={false}
      />
      <UrgencyFields
        priority={priority}
        onPriority={setPriority}
        afterHours={afterHours}
        onAfterHours={setAfterHours}
      />
      <TextArea
        label="Customer notes"
        hint="What they told you. The tech sees these on the job."
        rows={3}
        maxLength={5000}
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        placeholder="Gate code, pets, what's wrong"
      />
    </div>
  );

  // ---------------------------------------------------------------- When
  const shown = strip ? visibleDays(strip.days, lead.preferredDate, today) : [];
  const outside =
    shown.length > 0 && shown.every((d) => dayReason(d) === "outside_area");
  const nothingOpen =
    !outside && shown.length > 0 && shown.every((d) => d.openings === 0);
  const pickedDay = shown.find((d) => d.date === date) ?? null;
  const reason =
    pickedDay && pickedDay.openings === 0
      ? (dayReason(pickedDay) ?? "full")
      : null;
  const soonest = date ? nextOpenDay(shown, date) : null;
  const handLink = (
    <Button variant="tinted" size="md" href={newJobHref()} transition="push">
      Book by hand on New job
    </Button>
  );
  const meta = [
    minutes ? visitLength(minutes) : null,
    PRIORITY_WORD[priority],
    afterHours ? "After hours" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const when = (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-card bg-card px-4 py-3 shadow-card">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-headline">{choice}</span>
          <span className="truncate text-footnote text-label-2">{meta}</span>
        </span>
        <Button variant="tinted" size="sm" onClick={() => go("what")}>
          Change
        </Button>
      </div>

      {afterHours && !afterHoursBooking && (
        <Banner tone="info" title="After hours">
          These are your regular arrival windows. To send someone tonight or
          over the weekend, book it by hand on New job.
        </Banner>
      )}

      {stripLoading ? (
        <div aria-busy className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="skeleton block h-[76px] w-[54px] shrink-0 rounded-tile"
            />
          ))}
        </div>
      ) : !strip ? (
        <ReasonCard
          title="Couldn't load the open days"
          body="Check the connection and try again."
          action={
            <Button
              variant="secondary"
              size="md"
              onClick={() => ensureStrip(type)}
            >
              Try again
            </Button>
          }
        />
      ) : outside ? (
        <ReasonCard
          {...reasonText("outside_area", { zip: lead.zip })}
          action={handLink}
        />
      ) : shown.length === 0 || nothingOpen ? (
        <ReasonCard
          title="Nothing open in the next few weeks"
          body="Every day in range is full, closed or too far. You can still book it by hand."
          action={handLink}
        />
      ) : (
        <>
          <WeekStrip
            days={shown}
            today={today}
            selected={date}
            requested={lead.preferredDate}
            onSelect={selectDay}
            onPreview={(d) => {
              if (stripKey && window.matchMedia("(hover: hover)").matches)
                loadDay(d, stripKey, type, false);
            }}
          />
          <Legend />
          {date && (
            <section aria-labelledby="win-h" className="flex flex-col gap-3">
              <h2
                id="win-h"
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-headline">{dayLabel(date)}</span>
                {pickedDay && pickedDay.openings > 0 && (
                  <span className="text-footnote text-label-2">
                    {pickedDay.openings === 1
                      ? "1 window open"
                      : `${pickedDay.openings} windows open`}
                  </span>
                )}
              </h2>
              {reason ? (
                <ReasonCard
                  {...reasonText(reason, { zip: lead.zip, maxMiles })}
                  action={
                    <>
                      {soonest && (
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => selectDay(soonest)}
                        >
                          Soonest open: {dayLabel(soonest)}
                        </Button>
                      )}
                      {handLink}
                    </>
                  }
                />
              ) : (
                <WindowGrid
                  day={day}
                  loading={loadingDay === date && !day}
                  selected={start}
                  onSelect={(w) => setStart(w.start)}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );

  const bar =
    step === "what" ? (
      <BottomBar
        label="Next step"
        summary={
          <BarSummary
            title={type.kind ? choice : "Pick a job type"}
            subtitle={type.kind ? meta : lead.name}
          />
        }
        action={
          <Button size="lg" onClick={() => go("when")} disabled={!type.kind}>
            Next
          </Button>
        }
      />
    ) : (
      <BottomBar
        label="Booking"
        summary={
          <BarSummary
            title={
              outside || nothingOpen
                ? "No window to offer"
                : date
                  ? barWhen(date, today, win)
                  : "Pick a day"
            }
            subtitle={`${choice} · no tech yet`}
          />
        }
        action={
          <Button
            size="lg"
            onClick={book}
            loading={pending}
            disabled={!win || pending}
          >
            Book
          </Button>
        }
      />
    );

  return (
    <div ref={rootRef}>
      <DetailLayout
        bar={bar}
        railOnPhone="hide"
        railLabel="Lead"
        rail={
          <section className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
            <h2 className="text-headline">{lead.name}</h2>
            <dl className="flex flex-col gap-2 text-subhead">
              {lead.phone && <Row term="Phone">{lead.phone}</Row>}
              <Row term="Address">{lead.addressLine ?? "No address"}</Row>
              {askedDay && <Row term="Asked for">{askedDay}</Row>}
            </dl>
            {whoHref && (
              <Button
                href={whoHref}
                transition="back"
                variant="plain"
                size="sm"
                className="self-start"
              >
                Edit details
              </Button>
            )}
          </section>
        }
      >
        <div className="flex flex-col gap-5">
          <BookingSteps
            current={step === "what" ? 2 : 3}
            hrefs={whoHref ? { 1: whoHref } : undefined}
            onPick={(n) => {
              if (n === 2) go("what");
            }}
          />
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-label-2"
            >
              <MapPin size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-headline">{lead.name}</span>
              <span className="truncate text-footnote text-label-2">
                {[lead.addressLine ?? "No address", asked]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </div>
          <div key={step} className={cx(moved && "enter-rise")}>
            {step === "what" ? what : when}
          </div>
        </div>
      </DetailLayout>
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-label-2">{term}</dt>
      <dd className="min-w-0 text-label">{children}</dd>
    </div>
  );
}

function ReasonCard({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
      <div className="flex flex-col gap-1">
        <h3 className="text-headline">{title}</h3>
        <p className="text-subhead text-label-2">{body}</p>
      </div>
      <div className="flex flex-wrap gap-2">{action}</div>
    </div>
  );
}

function Legend() {
  const dot = (cls: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("size-2 rounded-full", cls)} />
      {text}
    </span>
  );
  return (
    <p className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-footnote text-label-2">
      {dot("bg-accent", "Best")}
      {dot("bg-[var(--sys-green)]", "Open")}
      {dot("shadow-[inset_0_0_0_1.5px_var(--sys-orange)]", "Limited")}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="text-label-3 line-through">
          18
        </span>
        Full
      </span>
    </p>
  );
}
