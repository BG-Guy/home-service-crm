"use client";

import { useEffect, useState } from "react";
import { FullscreenHub } from "@/ui/components/FullscreenHub";

// "Preview as the customer" (Quote to Paid I6): the customer's own /i page, full
// screen over the invoice (the kit FullscreenHub, like present mode), in a frame so
// Back or Close lands right back on the invoice. The page itself knows it's a staff
// preview (`?preview=1` + a staff session): no access-log row, no "viewed", Pay off,
// drafts shown, and a banner saying so. Its own lazy chunk.

export function InvoicePreviewHub({
  src,
  open,
  onOpenChange,
  customerFirstName,
}: {
  /** `/i/<token>?preview=1` (same origin). */
  src: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerFirstName: string;
}) {
  // Open after the first paint, so the hub grows from its slot (next to the
  // Preview button); the frame loads fresh on every open and goes on close.
  const [ready, setReady] = useState(false);
  const [framed, setFramed] = useState(false);
  useEffect(() => setReady(true), []);
  const show = ready && open;
  useEffect(() => {
    if (show) setFramed(true);
  }, [show]);
  return (
    <FullscreenHub
      title="Customer preview"
      subtitle={`What ${customerFirstName} sees · nothing is sent`}
      historyKey="preview"
      breakpoint="all"
      trigger="none"
      open={show}
      onOpenChange={onOpenChange}
      onExit={() => setFramed(false)}
      browserFullscreen={false}
      closeLabel="Close preview"
      // `visible`: the slot sits in the nav bar, which full screen hides
      // ([data-chrome]); the hub must not inherit that.
      className="visible absolute"
    >
      {framed ? (
        <iframe
          src={src}
          title={`What ${customerFirstName} sees`}
          className="block size-full border-0 bg-bg"
        />
      ) : null}
    </FullscreenHub>
  );
}
