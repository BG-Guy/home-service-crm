"use client";

import { CalendarPlus, FileSignature } from "lucide-react";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { LostSheet } from "./LostSheet";

/** The overlays of LeadActions (convert, more, lost), a lazy chunk loaded on first open. */
export default function LeadActionsSheets({
  leadId,
  lostReasons,
  more,
  convert,
  convertOpen,
  setConvertOpen,
  moreOpen,
  setMoreOpen,
  lostOpen,
  setLostOpen,
}: {
  leadId: string;
  lostReasons: string[];
  more: ActionSheetItem[];
  convert: (to: "job" | "estimate") => void;
  convertOpen: boolean;
  setConvertOpen: (v: boolean) => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  lostOpen: boolean;
  setLostOpen: (v: boolean) => void;
}) {
  return (
    <>
      <ActionSheet
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert lead"
        message="Customer, address, service, price and preferred date are filled in for you."
        items={[
          {
            label: "Book a job",
            icon: <CalendarPlus size={18} aria-hidden />,
            onSelect: () => convert("job"),
          },
          {
            label: "Send an estimate",
            icon: <FileSignature size={18} aria-hidden />,
            onSelect: () => convert("estimate"),
          },
        ]}
      />
      <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} items={more} />
      <LostSheet
        leadId={leadId}
        reasons={lostReasons}
        open={lostOpen}
        onOpenChange={setLostOpen}
      />
    </>
  );
}
