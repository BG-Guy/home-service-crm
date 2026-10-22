"use client";

import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { createJobAction } from "@/features/jobs/actions";
import { fetchDayWindows } from "@/features/jobs/availability/actions";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import { toMin, windowLabel } from "@/features/jobs/availability/windows";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Calendar, CalendarLegend } from "@/ui/components/Calendar";
import { toast } from "@/ui/components/Toast";
import { NAV_FORWARD } from "@/ui/motion/PageTransition";
import { techsFor, WindowPicker } from "./WindowPicker";

// Step 2 of the call-to-booking flow: pick a day on the availability calendar,
// then a 2-hour arrival window and the tech (best one preselected). Book job goes
// through the existing createJobAction (window + assignee + lead), which marks the
// lead booked and emits job.scheduled (the booking-confirmation automation).

const loadSheet = () => import("./WindowSheet");
const WindowSheet = dynamic(loadSheet, { ssr: false });

const DESKTOP = "(min-width: 1200px)";

export interface ScheduleLeadView {
  leadId: string;
  name: string;
  customerId: string;
  propertyId: string;
  addressLine: string | null;
  serviceTypeId: string | null;
  serviceName: string | null;
  notes: string | null;
}

const dayTitle = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(
    Date.UTC(y as number, (m as number) - 1, d),
  ).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

export function ScheduleFlow({
  lead,
  days,
  today,
  to,
}: {
  lead: ScheduleLeadView;
  days: DayAvailability[];
  today: string;
  to: string;
}) {
  const router = useRouter();
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const [date, setDate] = useState<string | null>(null);
  const [windows, setWindows] = useState<Record<string, DayAvailability>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [techId, setTechId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetUsed, setSheetUsed] = useState(false);
  const [pending, startBook] = useTransition();
  const inflight = useRef(new Map<string, Promise<DayAvailability | null>>());
  const clientId = useRef(crypto.randomUUID());

  const load = useCallback(
    (k: string) => {
      if (windows[k] || inflight.current.has(k)) return inflight.current.get(k);
      const p = fetchDayWindows({
        propertyId: lead.propertyId,
        serviceTypeId: lead.serviceTypeId,
        date: k,
      })
        .then((d) => {
          if (d) setWindows((w) => ({ ...w, [k]: d }));
          return d;
        })
        .catch(() => null)
        .finally(() => inflight.current.delete(k));
      inflight.current.set(k, p);
      return p;
    },
    [lead.propertyId, lead.serviceTypeId, windows],
  );

  const pickDefault = (d: DayAvailability | null) => {
    const w = d?.windows.find((x) => x.status === "open") ?? null;
    setStart(w?.start ?? null);
    setTechId(w?.suggested?.techId ?? null);
  };

  const selectDay = (k: string) => {
    setDate(k);
    setStart(null);
    setTechId(null);
    if (!window.matchMedia(DESKTOP).matches) {
      setSheetUsed(true);
      setSheetOpen(true);
    }
    const cached = windows[k];
    if (cached) {
      pickDefault(cached);
      return;
    }
    setLoading(k);
    void load(k)?.then((d) => {
      setLoading((cur) => (cur === k ? null : cur));
      pickDefault(d ?? null);
    });
  };

  const day = date ? (windows[date] ?? null) : null;
  const win: WindowSlot | null =
    day?.windows.find((w) => w.start === start) ?? null;
  const tech = techsFor(win).find((t) => t.techId === techId) ?? null;
  const ready = !!date && !!win && win.status === "open";

  const book = () => {
    if (!date || !win) return;
    startBook(async () => {
      const r = await createJobAction({
        customerId: lead.customerId,
        propertyId: lead.propertyId,
        serviceTypeId: lead.serviceTypeId,
        title: lead.serviceName?.trim() || "Service call",
        description: lead.notes,
        priority: "normal",
        afterHours: false,
        date,
        start: win.start,
        minutes: toMin(win.end) - toMin(win.start),
        assignees: tech
          ? [{ userId: tech.techId, role: "primary", splitBps: 10000 }]
          : [],
        leadId: lead.leadId,
        clientId: clientId.current,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSheetOpen(false);
      router.replace(`/leads/new/done?jobId=${r.data?.jobId}`, {
        transitionTypes: NAV_FORWARD,
      });
    });
  };

  const summary = date ? (
    <BarSummary
      title={
        win
          ? `${dayTitle(date)} · ${windowLabel(win.start, win.end)}`
          : dayTitle(date)
      }
      subtitle={
        win
          ? (tech?.name ?? "No tech yet")
          : loading === date
            ? "Loading windows…"
            : "Pick an arrival window"
      }
    />
  ) : (
    <BarSummary title="Pick a day" subtitle={lead.name} />
  );
  const bookButton = (
    <Button
      size="lg"
      onClick={book}
      loading={pending}
      disabled={!ready || pending}
    >
      Book job
    </Button>
  );
  const picker = (
    <WindowPicker
      day={day}
      loading={!!date && loading === date && !day}
      selected={start}
      onSelect={(w) => {
        setStart(w.start);
        setTechId(w.suggested?.techId ?? null);
      }}
      techId={techId}
      onTech={setTechId}
    />
  );

  return (
    <>
      <div className="min-[1200px]:grid min-[1200px]:grid-cols-[minmax(0,1fr)_380px] min-[1200px]:items-start min-[1200px]:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-label-2"
            >
              <MapPin size={18} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-headline">
                {lead.name}
                {lead.serviceName ? (
                  <span className="font-normal text-label-2">
                    {" · "}
                    {lead.serviceName}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-footnote text-label-2">
                {lead.addressLine ?? "No address"}
              </span>
            </span>
          </div>
          <div
            onPointerEnter={() => void loadSheet()}
            onFocusCapture={() => void loadSheet()}
          >
            <Calendar
              from={today}
              to={to}
              today={today}
              selected={date}
              onSelect={selectDay}
              onPreview={(k) => {
                if (window.matchMedia("(hover: hover)").matches) void load(k);
              }}
              getDay={(k) => {
                const d = byDate.get(k);
                return d
                  ? {
                      status: d.status,
                      hint:
                        d.openings === 1
                          ? "1 window open"
                          : `${d.openings} windows open`,
                    }
                  : { disabled: true };
              }}
              label="Choose a day"
            />
          </div>
          <CalendarLegend />
        </div>

        {/* Desktop: the side panel. */}
        <aside
          aria-label="Arrival windows"
          className="hidden min-[1200px]:sticky min-[1200px]:top-[calc(env(safe-area-inset-top)+56px)] min-[1200px]:flex"
        >
          <div className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-128px)] w-full flex-col rounded-card bg-card shadow-card">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5">
              {date ? (
                <>
                  <h2 className="text-title3">{dayTitle(date)}</h2>
                  {picker}
                </>
              ) : (
                <div className="flex flex-col gap-1 py-6 text-center">
                  <h2 className="text-headline">Pick a day</h2>
                  <p className="text-subhead text-label-2">
                    Its arrival windows and the best tech show up here.
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-sep px-5 py-4">
              <div className="min-w-0 flex-1">{summary}</div>
              {bookButton}
            </div>
          </div>
        </aside>
      </div>

      <BottomBar
        label="Booking"
        className="min-[1200px]:hidden"
        summary={summary}
        action={
          ready || !date ? (
            bookButton
          ) : (
            <Button
              size="lg"
              variant="secondary"
              onClick={() => setSheetOpen(true)}
            >
              Windows
            </Button>
          )
        }
      />

      {sheetUsed && (
        <WindowSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={date ? dayTitle(date) : "Pick a window"}
          footer={
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">{summary}</div>
              {bookButton}
            </div>
          }
        >
          {picker}
        </WindowSheet>
      )}
    </>
  );
}
