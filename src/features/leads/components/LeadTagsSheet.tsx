"use client";

import { TagEditor } from "@/features/settings/slots.client";
import { Button } from "@/ui/components/Button";
import { Sheet } from "@/ui/components/Sheet";
import { useLeadEnv } from "./lead-env";

/** Tags (Manage group): the shared tag picker in a small sheet (a lazy chunk). */
export default function LeadTagsSheet({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const env = useLeadEnv();
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) env.changed(leadId);
      }}
      title="Tags"
      detents={["content", "large"]}
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          onClick={() => onOpenChange(false)}
        >
          Done
        </Button>
      }
    >
      <div className="min-h-32 pb-4">
        <TagEditor entityType="lead" entityId={leadId} />
      </div>
    </Sheet>
  );
}
