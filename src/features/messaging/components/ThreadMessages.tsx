import { CalendarClock, Inbox } from "lucide-react";
import Link from "next/link";
import { dateKey, formatDayShort, formatTime } from "@/lib/time";
import { EmptyState } from "@/ui/components/EmptyState";
import { MessageBubble, MessageSeparator } from "@/ui/components/MessageBubble";
import type { ThreadMessage } from "../contracts";
import { channelLabel, templateLabel } from "../labels";
import { CancelScheduledButton } from "./ThreadActions";

const STATUS_WORD: Record<string, string> = {
  sent: "Sent",
  sent_manual: "Sent from phone",
  delivered: "Delivered",
  failed: "Not delivered",
  received: "Received",
  logged: "Logged reply",
  queued: "Queued",
};

/**
 * One conversation: bubbles for every channel grouped by day (company time zone),
 * then upcoming sends (scheduled / waiting in the outbox) with cancel.
 */
export function ThreadMessages({
  items,
  tz,
  showJobLinks = true,
  emptyHint = "No messages yet. Send the first one below.",
}: {
  items: ThreadMessage[];
  tz: string;
  showJobLinks?: boolean;
  emptyHint?: string;
}) {
  const past = items.filter((m) => m.kind === "message");
  const upcoming = items.filter((m) => m.kind === "scheduled");
  if (past.length === 0 && upcoming.length === 0)
    return (
      <EmptyState
        compact
        icon={<Inbox aria-hidden size={36} />}
        title="No messages"
        message={emptyHint}
      />
    );
  let lastDay = "";
  return (
    <div className="flex flex-col" aria-live="polite">
      {past.map((m, i) => {
        const day = dateKey(m.at, tz);
        const sep = day !== lastDay;
        lastDay = day;
        const next = past[i + 1];
        const tail =
          !next ||
          next.direction !== m.direction ||
          dateKey(next.at, tz) !== day ||
          new Date(next.at).getTime() - new Date(m.at).getTime() > 10 * 60_000;
        const meta = [
          formatTime(m.at, tz),
          m.direction === "out" && m.sender ? m.sender : null,
          m.templateKey ? templateLabel(m.templateKey) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={m.id}>
            {sep && (
              <MessageSeparator>{formatDayShort(m.at, tz)}</MessageSeparator>
            )}
            <MessageBubble
              direction={m.direction}
              tail={tail}
              failed={m.status === "failed"}
              channel={channelLabel(m.channel)}
              status={STATUS_WORD[m.status] ?? undefined}
              meta={
                <>
                  {meta}
                  {showJobLinks && m.jobId && m.jobNumber && (
                    <>
                      {" · "}
                      <Link
                        href={`/jobs/${m.jobId}`}
                        className="text-accent-text underline-offset-2 hover:underline"
                      >
                        {m.jobNumber}
                      </Link>
                    </>
                  )}
                </>
              }
            >
              {m.subject && m.channel === "email" ? (
                <span className="mb-1 block font-semibold">{m.subject}</span>
              ) : null}
              {m.body}
            </MessageBubble>
          </div>
        );
      })}

      {upcoming.length > 0 && (
        <section aria-label="Upcoming messages" className="mt-4">
          <MessageSeparator>Upcoming</MessageSeparator>
          <ul className="flex flex-col gap-2">
            {upcoming.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-3 rounded-card bg-card px-4 py-3 shadow-card"
              >
                <CalendarClock
                  aria-hidden
                  size={20}
                  className="mt-0.5 shrink-0 text-label-2"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-subhead font-semibold text-label">
                    {templateLabel(m.templateKey)}
                  </p>
                  <p className="text-footnote text-label-2">
                    {m.status === "pending_tap"
                      ? "Waiting in the outbox"
                      : m.status === "deferred_quiet"
                        ? `Held for quiet hours · ${formatDayShort(m.at, tz)} ${formatTime(m.at, tz)}`
                        : `${formatDayShort(m.at, tz)} at ${formatTime(m.at, tz)}`}
                    {" · "}
                    {channelLabel(m.channel)}
                    {m.jobNumber ? (
                      <>
                        {" · "}
                        {showJobLinks && m.jobId ? (
                          <Link
                            href={`/jobs/${m.jobId}`}
                            className="text-accent-text underline-offset-2 hover:underline"
                          >
                            {m.jobNumber}
                          </Link>
                        ) : (
                          m.jobNumber
                        )}
                      </>
                    ) : null}
                  </p>
                </div>
                {m.cancellable && (
                  <CancelScheduledButton
                    id={m.id}
                    label={templateLabel(m.templateKey)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
