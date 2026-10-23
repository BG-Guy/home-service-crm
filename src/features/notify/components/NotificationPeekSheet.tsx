"use client";

import { X } from "lucide-react";
import { formatDayShort, formatTime } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { toneStyle } from "@/ui/tone";
import type { NotificationDTO } from "../contracts";
import { notifyKind, openLabel } from "../kinds";

/**
 * A notification's peek (lazy chunk): its icon and kind, when it came, the whole
 * message, and "Open …" to go to the page it's about (when it links somewhere).
 */
export default function NotificationPeekSheet({
  item,
  timeZone,
  onOpen,
  onClose,
}: {
  item: NotificationDTO | null;
  timeZone: string;
  onOpen(n: NotificationDTO): void;
  onClose(): void;
}) {
  const k = item ? notifyKind(item.type) : null;
  const Icon = k?.icon;
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      label={item ? `Notification: ${item.title}` : "Notification"}
      detents={["large"]}
      trailing={
        <IconButton
          label="Close"
          variant="secondary"
          size={30}
          onClick={onClose}
        >
          <X size={17} strokeWidth={2.5} />
        </IconButton>
      }
      bodyClassName="pt-1"
      footer={
        item?.url ? (
          <Button block size="lg" onClick={() => onOpen(item)}>
            {openLabel(item.url)}
          </Button>
        ) : null
      }
    >
      {item && k && Icon && (
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="tint-bg tint-fg flex size-12 shrink-0 items-center justify-center rounded-[14px]"
              style={toneStyle(k.tone)}
            >
              <Icon size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-footnote font-semibold text-label-2">
                {k.label}
              </p>
              <p className="num text-footnote text-label-2">
                {formatDayShort(item.at, timeZone)} ·{" "}
                {formatTime(item.at, timeZone)}
              </p>
            </div>
            {item.priority === "high" && (
              <Pill tone="red" size="sm" dot={false}>
                Urgent
              </Pill>
            )}
          </div>
          <h2 className="text-title3">{item.title}</h2>
          {item.body && (
            <p className="whitespace-pre-line rounded-tile bg-fill-2 px-3 py-2.5 text-body">
              {item.body}
            </p>
          )}
          {!item.url && (
            <p className="text-footnote text-label-2">
              Nothing to open: this one is just for your information.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
