"use client";

import { Coffee, LogIn, LogOut, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { getPosition } from "@/client/geo";
import { runOffline } from "@/features/jobs/components/offline-client";
import type { ApprovalHint } from "@/features/vehicles/contracts";
import { OdometerCaptureButton } from "@/features/vehicles/slots.client";
import { formatInTz } from "@/lib/time";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";

// Time-clock card (SPEC M06 start/end of day): geostamped clock in/out through the
// offline outbox, breaks, and the odometer capture (B7 S48) when
// settings.vehicles.require_odometer_on_clock applies to this tech's vehicle.

export interface ClockCardProps {
  mode: "in" | "out";
  open: { id: string; clockInAt: string; breakMinutes: number } | null;
  tz: string;
  vehicle: { id: string; nickname: string; odometer: number | null } | null;
  requireOdometer: boolean;
  /** Odometer save outcome for this tech (`odometerApprovalHint`); sheet copy only. */
  odometerHint?: ApprovalHint;
  canClock: boolean;
  /** Clock out: jobs still on the way / in progress (asks before clocking out). */
  openJobs?: number;
}

function elapsed(fromIso: string, breakMin: number, now: number): string {
  const m = Math.max(
    0,
    Math.round((now - new Date(fromIso).getTime()) / 60_000) - breakMin,
  );
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, "0")} m` : `${m} m`;
}

export function ClockCard({
  mode,
  open,
  tz,
  vehicle,
  requireOdometer,
  odometerHint,
  canClock,
  openJobs = 0,
}: ClockCardProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState(open);
  const [odoId, setOdoId] = useState<string | null>(null);
  const [breakSheet, setBreakSheet] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => setState(open), [open]);
  useEffect(() => {
    if (!state) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [state]);

  if (!canClock) return null;
  const needOdo = requireOdometer && !!vehicle;

  const clock = (direction: "in" | "out", odometerReadingId: string | null) =>
    start(async () => {
      haptic();
      const geo = await getPosition({ timeoutMs: 6000, maxAgeMs: 60_000 });
      const r = await runOffline<{ timeEntryId: string }>(
        direction === "in" ? "time.clockIn" : "time.clockOut",
        {
          geo: geo
            ? {
                lat: geo.lat,
                lng: geo.lng,
                accuracyM: geo.accuracyM ?? null,
                at: geo.at,
              }
            : null,
          odometerReadingId,
        },
      );
      if (!r.queued && r.result && !r.result.ok) {
        toast.error(r.result.error);
        return;
      }
      if (direction === "in") {
        setState({
          id: r.result?.ok ? (r.result.data?.timeEntryId ?? "local") : "local",
          clockInAt: new Date().toISOString(),
          breakMinutes: 0,
        });
        toast.success(
          r.queued ? "Clocked in (will sync)" : "You're on the clock",
          {
            message: geo
              ? undefined
              : "Location was unavailable — saved without a geostamp.",
          },
        );
      } else {
        setState(null);
        toast.success(
          r.queued
            ? "Clocked out (will sync)"
            : "Clocked out — nice work today",
        );
        router.push("/today");
      }
    });

  const logBreak = (minutes: number) =>
    start(async () => {
      const r = await runOffline<{ breakMinutes: number }>("time.break", {
        minutes,
      });
      if (!r.queued && r.result && !r.result.ok) {
        toast.error(r.result.error);
        return;
      }
      setState((s) =>
        s ? { ...s, breakMinutes: s.breakMinutes + minutes } : s,
      );
      toast.success(`${minutes} min break logged`);
    });

  // ------------------------------------------------------------ not clocked in
  if (!state) {
    if (mode === "out")
      return (
        <div className="list-card flex items-center gap-3 p-4">
          <Timer size={22} className="text-label-2" aria-hidden />
          <p className="text-subhead text-label-2">You're not clocked in.</p>
        </div>
      );
    return (
      <div className="list-card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sys-green)_15%,transparent)] text-[var(--sys-green)]">
            <LogIn size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-headline font-semibold">Start your day</p>
            <p className="text-footnote text-label-2">
              {needOdo
                ? `Log ${vehicle?.nickname ?? "your vehicle"}'s odometer, then clock in.`
                : "Clock in when you head out."}
            </p>
          </div>
        </div>
        {needOdo && !odoId && vehicle ? (
          <OdometerCaptureButton
            vehicleId={vehicle.id}
            vehicleName={vehicle.nickname}
            lastOdometer={vehicle.odometer}
            source="clock"
            approvalHint={odometerHint}
            label="Log odometer & clock in"
            variant="filled"
            fullWidth
            onRecorded={(id) => {
              setOdoId(id);
              clock("in", id);
            }}
          />
        ) : (
          <Button
            size="lg"
            fullWidth
            loading={pending}
            icon={<LogIn size={20} aria-hidden />}
            onClick={() => clock("in", odoId)}
          >
            Clock in
          </Button>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ clocked in
  return (
    <div className="list-card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="relative flex size-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sys-green)_15%,transparent)] text-[var(--sys-green)]">
          <Timer size={20} aria-hidden />
          <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--card)] bg-[var(--sys-green)] motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0 flex-1">
          {/* Device clock vs the server's render time: a minute apart at most. */}
          <p
            className="num text-headline font-semibold"
            suppressHydrationWarning
          >
            {elapsed(state.clockInAt, state.breakMinutes, now)}
          </p>
          <p className="text-footnote text-label-2">
            On the clock since{" "}
            {formatInTz(state.clockInAt, tz, {
              hour: "numeric",
              minute: "2-digit",
            })}
            {state.breakMinutes > 0 && ` · ${state.breakMinutes} min break`}
          </p>
        </div>
        {mode === "in" && (
          <Button
            variant="gray"
            size="sm"
            icon={<Coffee size={16} aria-hidden />}
            disabled={pending}
            onClick={() => setBreakSheet(true)}
          >
            Break
          </Button>
        )}
      </div>
      {mode === "out" && openJobs > 0 && (
        <p className="text-footnote text-[var(--sys-orange)]">
          {openJobs === 1 ? "1 job is" : `${openJobs} jobs are`} still open.
          Complete {openJobs === 1 ? "it" : "them"} or put{" "}
          {openJobs === 1 ? "it" : "them"} on hold before you clock out.
        </p>
      )}
      {mode === "out" &&
        (needOdo && !odoId && vehicle ? (
          <OdometerCaptureButton
            vehicleId={vehicle.id}
            vehicleName={vehicle.nickname}
            lastOdometer={vehicle.odometer}
            source="clock"
            approvalHint={odometerHint}
            label="Log odometer & clock out"
            variant="filled"
            fullWidth
            onRecorded={(id) => {
              setOdoId(id);
              clock("out", id);
            }}
          />
        ) : (
          <Button
            size="lg"
            fullWidth
            variant="destructive"
            loading={pending}
            icon={<LogOut size={20} aria-hidden />}
            onClick={() =>
              openJobs > 0 ? setConfirmOut(true) : clock("out", odoId)
            }
            className={cx(pending && "opacity-90")}
          >
            Clock out
          </Button>
        ))}
      <ActionSheet
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title={`${openJobs === 1 ? "1 job is" : `${openJobs} jobs are`} still open`}
        message="Your time stops now, but the jobs stay open until they're completed or on hold."
        items={[
          {
            label: "Clock out anyway",
            destructive: true,
            onSelect: () => setTimeout(() => clock("out", odoId), 0),
          },
        ]}
      />
      <ActionSheet
        open={breakSheet}
        onOpenChange={setBreakSheet}
        title="Log a break"
        message="Breaks are subtracted from your hours."
        items={[15, 30, 45, 60].map((m) => ({
          label: `${m} minutes`,
          onSelect: () => logBreak(m),
        }))}
      />
    </div>
  );
}
