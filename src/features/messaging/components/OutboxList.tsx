"use client";

import { CheckCircle2, Inbox, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SmsSeparator } from "@/client/sms-href";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import type { OutboxCard } from "../contracts";
import { OutboxCardView } from "./OutboxCardView";

/**
 * Outbox (SPEC M12 link mode): cards waiting for a person to tap Send. "Send one by
 * one" (Next mode) steps through the queue, one card at a time.
 */
export function OutboxList({
  cards,
  scope,
  canSeeAll,
  linkDelimiter,
  renderedAt,
  linkJobs = false,
}: {
  cards: OutboxCard[];
  scope: "mine" | "all";
  canSeeAll: boolean;
  linkDelimiter: "auto" | SmsSeparator;
  /** Server render time (ms): the cards' relative times hydrate identically. */
  renderedAt?: number;
  /** The viewer may open the cards' jobs (job numbers link). */
  linkJobs?: boolean;
}) {
  const router = useRouter();
  const [handled, setHandled] = useState<Set<string>>(() => new Set());
  const [stepMode, setStepMode] = useState(false);
  const live = useMemo(
    () => cards.filter((c) => !handled.has(c.id)),
    [cards, handled],
  );
  const done = (id: string) => setHandled((prev) => new Set(prev).add(id));

  const header = canSeeAll ? (
    <div className="mb-4 px-1">
      <SegmentedControl
        label="Whose texts"
        value={scope}
        segments={[
          { value: "mine", label: "Mine" },
          { value: "all", label: "Everyone" },
        ]}
        onChange={(v) =>
          router.replace(
            v === "all" ? "/messages/outbox?scope=all" : "/messages/outbox",
          )
        }
      />
    </div>
  ) : null;

  if (live.length === 0)
    return (
      <>
        {header}
        <EmptyState
          icon={
            handled.size > 0 ? (
              <CheckCircle2 aria-hidden size={44} />
            ) : (
              <Inbox aria-hidden size={44} />
            )
          }
          title={handled.size > 0 ? "All caught up" : "No texts waiting"}
          message={
            handled.size > 0
              ? "Every text in your outbox is handled."
              : "Reminders, on-my-way texts and follow-ups that need a tap to send show up here."
          }
        />
      </>
    );

  if (stepMode) {
    const card = live[0];
    const total = live.length + handled.size;
    return (
      <>
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-subhead text-label-2">
            {handled.size + 1} of {total}
          </p>
          <Button variant="plain" size="sm" onClick={() => setStepMode(false)}>
            Show all
          </Button>
        </div>
        {card && (
          <OutboxCardView
            key={card.id}
            card={card}
            linkDelimiter={linkDelimiter}
            onDone={done}
            showAssignee={scope === "all"}
            emphasized
            renderedAt={renderedAt}
            linkJobs={linkJobs}
          />
        )}
        {live.length > 1 && (
          <p className="mt-3 px-1 text-footnote text-label-2">
            Next: {live[1]?.customerName} · {live[1]?.templateLabel}
          </p>
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {live.length > 1 && (
        <Button
          variant="tinted"
          fullWidth
          className="mb-4"
          icon={<Play aria-hidden size={18} />}
          onClick={() => setStepMode(true)}
        >
          Send one by one ({live.length})
        </Button>
      )}
      <ul className="flex flex-col gap-3">
        {live.map((c) => (
          <li key={c.id}>
            <OutboxCardView
              card={c}
              linkDelimiter={linkDelimiter}
              onDone={done}
              showAssignee={scope === "all"}
              renderedAt={renderedAt}
              linkJobs={linkJobs}
            />
          </li>
        ))}
      </ul>
      <p className="mt-4 px-1 text-footnote text-label-2">
        Texts open in your phone&apos;s Messages app with the words filled in.
        Expired texts are never sent late.
      </p>
    </>
  );
}
