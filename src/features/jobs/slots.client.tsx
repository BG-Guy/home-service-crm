"use client";

// B2 client slots (BUILD_PLAN §5.1 S8, S9). Serializable props; they call only
// B2's own server actions; heavy sheets are lazy chunks.

import {
  CalendarCheck,
  CalendarClock,
  CircleCheck,
  UserPlus,
  UserRoundPlus,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { haptic } from "@/ui/motion/haptics";
import type { AssignJobButtonProps, PortalJobActionsProps } from "./contracts";
import { portalConfirmJob, portalRequestReschedule } from "./portal-actions";

const AssignSheet = dynamic(() => import("./components/AssignSheet"), {
  ssr: false,
});

/** S9: "Assign" button → techs with conflict hints, window, split (B2 `scheduleJob`). */
export function AssignJobButton({
  jobId,
  label = "Assign",
  variant = "tinted",
  iconOnly,
}: AssignJobButtonProps & {
  /** B2 addition: a round icon button (label as its accessible name), for list rows. */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const show = () => {
    setMounted(true);
    setOpen(true);
  };
  // Warm the chunk on intent.
  const warm = () => void import("./components/AssignSheet");
  return (
    <>
      {iconOnly ? (
        <IconButton
          label={label}
          variant="plain"
          size={36}
          onClick={show}
          onPointerEnter={warm}
        >
          <UserRoundPlus size={20} aria-hidden />
        </IconButton>
      ) : (
        <Button
          variant={variant}
          size="sm"
          icon={<UserPlus size={16} aria-hidden />}
          onClick={show}
          onPointerEnter={warm}
        >
          {label}
        </Button>
      )}
      {mounted && (
        <AssignSheet jobId={jobId} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

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
  const [note, setNote] = useState("");
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

  const reschedule = () =>
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
          onClick={() => setSheet(true)}
        >
          Request a different time
        </Button>
      )}
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Request a new time"
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => setSheet(false)}>
            Cancel
          </Button>
        }
        footer={
          <Button size="lg" fullWidth loading={pending} onClick={reschedule}>
            Send request
          </Button>
        }
      >
        <div className="px-4 pb-4">
          <TextArea
            label="Anything we should know? (optional)"
            placeholder="e.g. Mornings work best next week"
            value={note}
            maxLength={1000}
            rows={4}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </Sheet>
    </div>
  );
}
