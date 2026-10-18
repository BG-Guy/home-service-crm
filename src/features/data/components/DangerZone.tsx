"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { ConfirmTyped } from "@/ui/components/ConfirmTyped";
import { ListRow, ListSection } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { resetDemoData } from "../actions";

/** "Reset demo data": wipes everything and reseeds the demo (dev / DEMO_MODE only). */
export function DangerZone() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ListSection
        header="Danger zone"
        footer="Deletes every customer, job, invoice, user and setting, then loads the Acme Home Services demo. Everyone is signed out. Sign back in as admin@demo.test / demo1234."
      >
        <ListRow
          icon={<RotateCcw size={17} />}
          iconTone="red"
          title="Reset demo data"
          destructive
          onClick={() => setOpen(true)}
          accessory="none"
        />
      </ListSection>
      <ConfirmTyped
        open={open}
        onOpenChange={setOpen}
        title="Reset all data?"
        message="This can't be undone. Type RESET to confirm."
        phrase="RESET"
        confirmLabel="Reset"
        pendingLabel="Resetting…"
        onConfirm={async () => {
          const r = await resetDemoData({ phrase: "RESET" });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          window.location.href = "/login";
        }}
      />
    </>
  );
}
