"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { logLeadCall } from "../actions";
import { useLeadEnv } from "./lead-env";
import {
  clearPendingCall,
  type PendingCall,
  readPendingCall,
  skipPendingCall,
} from "./pending-call";

// The outcome sheet (with the Sheet kit) loads on the first call.
const loadOutcomeSheet = () =>
  import("@/features/customers/components/CallOutcomeSheet");
const CallOutcomeSheet = dynamic(
  () => loadOutcomeSheet().then((m) => m.CallOutcomeSheet),
  { ssr: false },
);

/** "How did it go with Luke?" (the plain title for numbers and long names). */
function callTitle(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return !first || /\d/.test(first) || first.length > 9
    ? "How did the call go?"
    : `How did it go with ${first}?`;
}

/**
 * "How did the call go?" for one lead: logs the outcome (a no-answer drafts a
 * text and a call-back task; a wrong number stops the follow-ups). Closing it
 * without saving counts as a Skip: it asks again next time (pending-call.ts).
 */
export function CallOutcomeFlow({
  leadId,
  name,
  open,
  onOpenChange,
}: {
  leadId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const env = useLeadEnv();
  const saved = useRef(false);
  return (
    <CallOutcomeSheet
      open={open}
      onOpenChange={(o) => {
        if (o) saved.current = false;
        else if (!saved.current) skipPendingCall(leadId);
        onOpenChange(o);
      }}
      title={callTitle(name)}
      footnote="No answer or busy drafts a text and a call-back in 15 minutes. Wrong number stops the follow-up texts."
      onSave={async ({ outcome, notes }) => {
        const res = await logLeadCall({
          leadId,
          outcome,
          notes,
          clientId: crypto.randomUUID(),
        });
        if (!res.ok) {
          env.notify({ title: res.error, tone: "error" });
          return false;
        }
        saved.current = true;
        clearPendingCall(leadId);
        const d = res.data;
        env.notify({
          tone: "success",
          title:
            outcome === "wrong_number"
              ? "Wrong number: follow-ups stopped"
              : d?.retryTaskId
                ? d.textQueued
                  ? "Logged · text drafted, call back in 15 min"
                  : "Logged · call back in 15 min"
                : "Call logged",
        });
        env.changed(leadId);
        return true;
      }}
    />
  );
}

/**
 * Asks again for a call whose outcome was never logged (a Skip, or the page
 * reloading when the phone app came back). Mount once per lead screen.
 */
export function PendingCallPrompt() {
  const [pending, setPending] = useState<PendingCall | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const p = readPendingCall();
    if (!p) return;
    void loadOutcomeSheet();
    setPending(p);
    const t = setTimeout(() => setOpen(true), 450);
    return () => clearTimeout(t);
  }, []);
  if (!pending) return null;
  return (
    <CallOutcomeFlow
      leadId={pending.leadId}
      name={pending.name}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
