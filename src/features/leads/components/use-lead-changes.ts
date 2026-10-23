// Lead changes with their way back (leads-flow redesign item 4). A plain module of
// client hooks: every status or owner change shows Undo for a few seconds (a
// toast, or the card's own bar inside the sheet) and refreshes the open card.
import { useCallback, useRef, useState } from "react";
import type { ActionResult } from "@/lib/types";
import {
  claimLead,
  markLeadNotSpam,
  markLeadSpam,
  releaseLead,
  reopenLead,
  setLeadStatus,
  undoLeadChange,
} from "../actions";
import type { LeadStatus } from "../contracts";
import { STATUS_STEPS, STATUS_WORD, type StatusStep } from "../rules";
import { useLeadEnv } from "./lead-env";

type Done<T> = string | ((data: T | undefined) => string);

export function useLeadChanges() {
  const env = useLeadEnv();
  const envRef = useRef(env);
  envRef.current = env;
  const [busy, setBusy] = useState<string | null>(null);

  /** Undo a recorded status change (the lead_events row the action returned). */
  const undoEvent = useCallback(
    (leadId: string, eventId: string) => async () => {
      const e = envRef.current;
      const u = await undoLeadChange({ leadId, eventId });
      if (!u.ok) return e.notify({ title: u.error, tone: "error" });
      e.notify({
        title: `Undone: back to ${STATUS_WORD[(u.data?.status ?? "new") as LeadStatus]}`,
      });
      e.changed(leadId);
    },
    [],
  );

  const run = useCallback(
    async <T extends object>(
      key: string,
      leadId: string,
      call: () => Promise<ActionResult<T>>,
      done: Done<T>,
      undo?: (data: T | undefined) => (() => void) | undefined,
    ): Promise<T | null> => {
      const e = envRef.current;
      setBusy(key);
      let r: ActionResult<T>;
      try {
        r = await call();
      } finally {
        setBusy(null);
      }
      if (!r.ok) {
        e.notify({ title: r.error, tone: "error" });
        return null;
      }
      const data = r.data;
      const eventId = (data as { eventId?: string | null } | undefined)
        ?.eventId;
      e.notify({
        title: typeof done === "function" ? done(data) : done,
        tone: "success",
        undo: undo
          ? undo(data)
          : eventId
            ? undoEvent(leadId, eventId)
            : undefined,
      });
      e.changed(leadId);
      return (data ?? {}) as T;
    },
    [undoEvent],
  );

  return {
    busy,
    /** Contacted / Not contacted / Qualify / Unqualify. */
    step: (leadId: string, step: StatusStep) =>
      run(
        step,
        leadId,
        () => setLeadStatus({ leadId, status: STATUS_STEPS[step].to }),
        STATUS_STEPS[step].done,
      ),
    reopen: (leadId: string) =>
      run(
        "reopen",
        leadId,
        () => reopenLead({ leadId }),
        (d) => `Reopened: back to ${STATUS_WORD[d?.status ?? "contacted"]}`,
      ),
    spam: (leadId: string) =>
      run("spam", leadId, () => markLeadSpam({ leadId }), "Marked as spam"),
    /** "Not spam" on a spam lead, "Looks legit" on a Check lead. */
    notSpam: (leadId: string, check: boolean) =>
      run(
        check ? "legit" : "not_spam",
        leadId,
        () => markLeadNotSpam({ leadId }),
        (d) =>
          check
            ? "Moved to the inbox"
            : `Not spam: back to ${STATUS_WORD[d?.status ?? "new"]}`,
      ),
    claim: (leadId: string) =>
      run(
        "claim",
        leadId,
        () => claimLead({ leadId }),
        "Claimed: it's yours",
        () => () =>
          void run(
            "release",
            leadId,
            () => releaseLead({ leadId }),
            "Released again",
          ),
      ),
    /** Ask first (the caller confirms), then take it over; Undo gives it back. */
    takeOver: (leadId: string, from: string | null) =>
      run(
        "take_over",
        leadId,
        () => claimLead({ leadId, force: true }),
        `Taken over${from ? `. We let ${from} know` : ""}`,
        (d) => {
          const prev = d?.previousUserId;
          return prev
            ? () =>
                void run(
                  "release",
                  leadId,
                  () => releaseLead({ leadId, giveBackTo: prev }),
                  `Given back${from ? ` to ${from}` : ""}`,
                )
            : undefined;
        },
      ),
    release: (leadId: string) =>
      run(
        "release",
        leadId,
        () => releaseLead({ leadId }),
        "Released: anyone can claim it",
        () => () =>
          void run(
            "claim",
            leadId,
            () => claimLead({ leadId }),
            "Claimed again",
          ),
      ),
    /** For changes made elsewhere (the Lost sheet): toast + Undo by event id. */
    announce: (leadId: string, title: string, eventId: string | null) => {
      const e = envRef.current;
      e.notify({
        title,
        tone: "success",
        undo: eventId ? undoEvent(leadId, eventId) : undefined,
      });
      e.changed(leadId);
    },
  };
}
