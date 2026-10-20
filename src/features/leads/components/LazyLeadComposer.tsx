"use client";

import { MessageSquare } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

// The composer (templates, consent checks, send) is a chunk of its own: the page
// shows a pill that looks like the composer and loads the real one on the first
// tap or focus (hover prefetches it).
const load = () => import("@/features/messaging/slots.client");
const MessageComposer = dynamic(() => load().then((m) => m.MessageComposer), {
  ssr: false,
  loading: () => (
    <div className="skeleton h-[88px] w-full rounded-control" aria-busy />
  ),
});

/** "Text them" on the lead page, loaded behind first open. */
export function LazyLeadComposer({
  customerId,
  leadId,
}: {
  customerId: string;
  leadId: string;
}) {
  const [on, setOn] = useState(false);
  if (on)
    return (
      <MessageComposer
        customerId={customerId}
        leadId={leadId}
        defaultChannel="sms"
        compact
        autoFocus
      />
    );
  return (
    <button
      type="button"
      onClick={() => setOn(true)}
      onFocus={() => void load()}
      onPointerEnter={() => void load()}
      className="pressable flex min-h-12 w-full items-center gap-2.5 rounded-pill bg-field px-4 text-left text-body text-label-3"
    >
      <MessageSquare size={18} aria-hidden className="text-label-2" />
      Write a text…
    </button>
  );
}
