"use client";

import { useTransition } from "react";
import { dismissSetupChecklistAction } from "@/features/settings/actions";
import { Button } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";

/** Brings back the dismissed setup checklist (Today + Settings overview). */
export function ReopenSetupButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="plain"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await dismissSetupChecklistAction({ dismissed: false });
          if (!r.ok) toast.error(r.error);
        })
      }
    >
      Show setup checklist
    </Button>
  );
}
