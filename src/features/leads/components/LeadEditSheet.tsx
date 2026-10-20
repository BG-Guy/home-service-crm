"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/ui/components/Button";

export interface LeadEditable {
  id: string;
  name: string;
  serviceTypeId: string | null;
  service: string | null;
  quotedPriceCents: number | null;
  preferredDate: string | null;
  preferredWindow: string | null;
  notes: string | null;
  sourceId: string | null;
}

// The form sheet is a chunk of its own, fetched on hover/focus or the first tap.
const load = () => import("./LeadEditForm");
const LeadEditForm = dynamic(load, { ssr: false });

/** "Edit" in the lead nav bar: service, price, preferred date/window, notes, source. */
export function LeadEditSheet({
  lead,
  sources,
  services,
}: {
  lead: LeadEditable;
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const [open, setOpenState] = useState(false);
  const [armed, setArmed] = useState(false);
  const setOpen = (v: boolean) => {
    if (v) setArmed(true);
    setOpenState(v);
  };
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        onClick={() => setOpen(true)}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        aria-haspopup="dialog"
      >
        Edit
      </Button>
      {armed && (
        <LeadEditForm
          open={open}
          setOpen={setOpen}
          lead={lead}
          sources={sources}
          services={services}
        />
      )}
    </>
  );
}
