"use client";

import { SquarePen } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { CustomerPicker } from "@/features/customers/slots.client";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";

// The composer loads only when the sheet opens (keeps /messages light).
const MessageComposer = dynamic(
  () => import("../slots.client").then((m) => m.MessageComposer),
  { ssr: false, loading: () => <Skeleton height={180} rounded="card" /> },
);

/** "New message": pick a customer (B1 S3), then compose. */
export function NewMessageButton({
  variant = "icon",
}: {
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  return (
    <>
      {variant === "icon" ? (
        <IconButton label="New message" onClick={() => setOpen(true)}>
          <SquarePen aria-hidden size={22} />
        </IconButton>
      ) : (
        <Button
          variant="filled"
          icon={<SquarePen aria-hidden size={18} />}
          onClick={() => setOpen(true)}
        >
          New message
        </Button>
      )}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="New message"
        detents={["large"]}
        onClosed={() => setCustomerId(null)}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-8">
          <CustomerPicker
            name="to"
            allowCreate={false}
            onChange={(v) => setCustomerId(v.customerId)}
          />
          {customerId ? (
            <MessageComposer
              key={customerId}
              customerId={customerId}
              autoFocus
            />
          ) : (
            <p className="px-1 text-subhead text-label-2">
              Choose who to message.
            </p>
          )}
        </div>
      </Sheet>
    </>
  );
}
