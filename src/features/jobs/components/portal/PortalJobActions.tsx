"use client";

// S8: the customer's Confirm / Request reschedule on `/j/[token]`. Its own module
// so the portal doesn't pull the staff slots; the reschedule sheet is a lazy
// chunk mounted on first tap (warmed on hover / touch).

import { CalendarCheck, CalendarClock, CircleCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import type { PortalJobActionsProps } from "../../contracts";
import {
  portalConfirmJob,
  portalRequestReschedule,
} from "../../portal-actions";

const loadSheet = () => import("./RescheduleSheet");
const RescheduleSheet = dynamic(loadSheet, { ssr: false });
const warmSheet = () => void loadSheet();

const CONFIRMABLE = new Set(["scheduled"]);
const RESCHEDULABLE = new Set(["scheduled", "confirmed", "unscheduled"]);

/** S8: customer Confirm / Request reschedule on `/j/[token]` (token re-validated server-side). */
export function PortalJobActions({
  token,
  jobId,
  status,
  confirmedAt,
}: PortalJobActionsProps) {
  const [confirmed, setConfirmed] = useState(
    !!confirmedAt || status === "confirmed",
  );
  const [requested, setRequested] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [pending, start] = useTransition();

  if (!RESCHEDULABLE.has(status) && !confirmed) return null;

  const confirm = () =>
    start(async () => {
      const r = await portalConfirmJob({ token, jobId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      haptic();
      setConfirmed(true);
      toast.success("Thanks — you're confirmed");
    });

  const reschedule = (note: string) =>
    start(async () => {
      const r = await portalRequestReschedule({
        token,
        jobId,
        note: note.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      haptic();
      setRequested(true);
      setSheet(false);
      toast.success("Request sent", {
        message: "We'll reach out to find a new time.",
      });
    });

  return (
    <div className="flex flex-col gap-2">
      {requested ? (
        <p className="flex items-center gap-2 rounded-card bg-card px-4 py-3 text-subhead shadow-card">
          <CalendarClock
            size={18}
            className="text-[var(--sys-orange)]"
            aria-hidden
          />
          Reschedule requested — we'll be in touch shortly.
        </p>
      ) : confirmed ? (
        <p className="flex items-center gap-2 rounded-card bg-card px-4 py-3 text-subhead shadow-card">
          <CircleCheck
            size={18}
            className="text-[var(--sys-green)]"
            aria-hidden
          />
          Appointment confirmed
        </p>
      ) : CONFIRMABLE.has(status) ? (
        <Button
          size="lg"
          fullWidth
          loading={pending}
          icon={<CalendarCheck size={20} aria-hidden />}
          onClick={confirm}
        >
          Confirm appointment
        </Button>
      ) : null}
      {!requested && RESCHEDULABLE.has(status) && (
        <Button
          variant="gray"
          size="lg"
          fullWidth
          disabled={pending}
          onPointerEnter={warmSheet}
          onTouchStart={warmSheet}
          onClick={() => {
            setSheetMounted(true);
            setSheet(true);
          }}
        >
          Request a different time
        </Button>
      )}
      {sheetMounted && (
        <RescheduleSheet
          open={sheet}
          onOpenChange={setSheet}
          pending={pending}
          onSubmit={reschedule}
        />
      )}
    </div>
  );
}
