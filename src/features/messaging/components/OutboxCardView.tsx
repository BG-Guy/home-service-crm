"use client";

import { Clock, Copy, MessageCircle, Pencil, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSmsSeparatorOverride,
  type SmsSeparator,
  smsHref,
  waHref,
} from "@/client/sms-href";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { Sheet } from "@/ui/components/Sheet";
import { Pill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { editOutboxBody, markOutboxSent, skipOutbox } from "../actions";
import type { OutboxCard } from "../contracts";
import { smsSegments } from "../lint";

export type OutboxOutcome = "sent" | "skipped";

/** "in 12 min" / "2 h ago" without a date library. */
export function relativeTime(iso: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  const label =
    m < 1
      ? "now"
      : m < 60
        ? `${m} min`
        : m < 1440
          ? `${Math.round(m / 60)} h`
          : `${Math.round(m / 1440)} d`;
  if (label === "now") return "now";
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/**
 * "Now" for the relative times: the server's render time until mount, so the
 * server HTML and the first client render agree (React #418 on every Outbox
 * load, QA2 T2), then the device clock. Cards made on the client (the Composer's
 * pending card) start from the device clock.
 */
function useNow(renderedAt: number | undefined, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => renderedAt ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The link-mode send: open Messages / WhatsApp prefilled; return asks "Sent?". */
export function OutboxCardView({
  card,
  linkDelimiter = "auto",
  onDone,
  showAssignee = false,
  emphasized = false,
  renderedAt,
  linkJobs = false,
}: {
  card: OutboxCard;
  linkDelimiter?: "auto" | SmsSeparator;
  onDone?: (id: string, outcome: OutboxOutcome) => void;
  showAssignee?: boolean;
  emphasized?: boolean;
  /** Server render time (ms) for server-rendered cards: hydration-safe relative times. */
  renderedAt?: number;
  /** The viewer may open the card's job: its number links there. */
  linkJobs?: boolean;
}) {
  const now = useNow(renderedAt);
  const [body, setBody] = useState(card.body);
  const [editing, setEditing] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [busy, setBusy] = useState<null | "sent" | "skip">(null);
  const awaiting = useRef(false);
  const leftPage = useRef(false);

  const expired = !!card.expiresAt && new Date(card.expiresAt).getTime() <= now;
  const seg = smsSegments(body);

  // Coming back from Messages → ask whether it went out.
  useEffect(() => {
    const onVis = () => {
      if (!awaiting.current) return;
      if (document.visibilityState === "hidden") leftPage.current = true;
      else if (leftPage.current) {
        awaiting.current = false;
        leftPage.current = false;
        setAskOpen(true);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const href = useCallback(() => {
    if (card.channel === "whatsapp") return waHref(card.to, body);
    const device = getSmsSeparatorOverride();
    const sep =
      device ?? (linkDelimiter !== "auto" ? linkDelimiter : undefined);
    return smsHref(card.to, body, undefined, sep);
  }, [card.channel, card.to, body, linkDelimiter]);

  const send = () => {
    awaiting.current = true;
    leftPage.current = false;
    window.location.href = href();
    // Desktop / no app switch: ask after a moment anyway.
    setTimeout(() => {
      if (awaiting.current && !leftPage.current) {
        awaiting.current = false;
        setAskOpen(true);
      }
    }, 2500);
  };

  const confirmSent = async () => {
    setBusy("sent");
    const res = await markOutboxSent({
      id: card.id,
      body: body !== card.body ? body : undefined,
    });
    setBusy(null);
    setAskOpen(false);
    if (!res.ok) {
      toast({ title: "Couldn't save", message: res.error, tone: "error" });
      return;
    }
    toast({ title: "Marked as sent", tone: "success" });
    onDone?.(card.id, "sent");
  };

  const skip = async () => {
    setBusy("skip");
    const res = await skipOutbox({ id: card.id });
    setBusy(null);
    setAskOpen(false);
    if (!res.ok) {
      toast({ title: "Couldn't skip", message: res.error, tone: "error" });
      return;
    }
    toast({ title: "Skipped", message: card.templateLabel });
    onDone?.(card.id, "skipped");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast({
        title: "Text copied",
        message: `Paste it to ${formatPhoneDisplay(card.to)}`,
      });
    } catch {
      toast({ title: "Copy isn't available here", tone: "warning" });
    }
  };

  const saveEdit = async () => {
    setEditing(false);
    if (body === card.body) return;
    const res = await editOutboxBody({ id: card.id, body });
    if (!res.ok)
      toast({
        title: "Couldn't save the edit",
        message: res.error,
        tone: "error",
      });
  };

  return (
    <article
      aria-label={`Text to ${card.customerName}`}
      className={cx(
        "rounded-card bg-card p-4 shadow-card",
        emphasized && "ring-2 ring-accent/40",
        expired && "opacity-70",
      )}
    >
      <header className="flex items-start gap-3">
        <Avatar name={card.customerName} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-headline text-label">
              {card.customerName}
            </h3>
            {card.expiresAt ? (
              <Pill tone={expired ? "red" : "orange"} size="sm">
                <Clock aria-hidden size={12} />
                {expired
                  ? "Expired"
                  : `Expires ${relativeTime(card.expiresAt, now)}`}
              </Pill>
            ) : (
              <span className="shrink-0 text-footnote text-label-2">
                {relativeTime(card.dueAt, now)}
              </span>
            )}
          </div>
          <p className="truncate text-subhead text-label-2">
            {card.templateLabel}
            {card.jobNumber ? (
              <>
                {" · "}
                <TextLink
                  href={linkJobs && card.jobId ? `/jobs/${card.jobId}` : null}
                >
                  {card.jobNumber}
                </TextLink>
              </>
            ) : null}
            {card.channel === "whatsapp" ? " · WhatsApp" : ""}
            {showAssignee && card.assignedName ? ` · ${card.assignedName}` : ""}
          </p>
        </div>
      </header>

      <div className="mt-3">
        {editing ? (
          <TextArea
            label="Message"
            hideLabel
            value={body}
            rows={4}
            autoFocus
            onChange={(e) => setBody(e.currentTarget.value)}
            onBlur={saveEdit}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full whitespace-pre-wrap break-words rounded-[14px] bg-fill-2 px-3 py-2.5 text-left text-body text-label"
            aria-label="Edit message"
          >
            {body}
          </button>
        )}
        <p className="mt-1.5 flex justify-between px-1 text-caption text-label-2">
          <span>To {formatPhoneDisplay(card.to)}</span>
          <span className={cx(seg.encoding === "UCS-2" && "text-warning")}>
            {seg.segments} segment{seg.segments === 1 ? "" : "s"}
            {seg.encoding === "UCS-2" ? " · emoji/special chars" : ""}
          </span>
        </p>
      </div>

      <footer className="mt-3 flex items-center gap-2">
        <Button
          variant="filled"
          className="flex-1"
          icon={
            card.channel === "whatsapp" ? (
              <MessageCircle aria-hidden size={18} />
            ) : (
              <Send aria-hidden size={18} />
            )
          }
          onClick={send}
          disabled={expired || !body.trim()}
        >
          {card.channel === "whatsapp" ? "Open WhatsApp" : "Send"}
        </Button>
        <Button
          variant="gray"
          aria-label="Copy text"
          icon={<Copy aria-hidden size={18} />}
          onClick={copy}
        >
          <span className="sr-only sm:not-sr-only">Copy</span>
        </Button>
        {!editing && (
          <Button
            variant="gray"
            aria-label="Edit text"
            icon={<Pencil aria-hidden size={18} />}
            onClick={() => setEditing(true)}
          >
            <span className="sr-only">Edit</span>
          </Button>
        )}
        <Button
          variant="plain"
          onClick={skip}
          loading={busy === "skip"}
          disabled={busy !== null}
        >
          Skip
        </Button>
      </footer>

      <Sheet
        open={askOpen}
        onOpenChange={setAskOpen}
        title="Did the text go out?"
        detents={["content"]}
      >
        <div className="flex flex-col gap-3 pb-6">
          <p className="px-1 text-subhead text-label-2">
            {card.customerName} · {card.templateLabel}
          </p>
          <Button
            variant="filled"
            size="lg"
            fullWidth
            loading={busy === "sent"}
            disabled={busy !== null}
            onClick={confirmSent}
          >
            Yes, it&apos;s sent
          </Button>
          <Button
            variant="gray"
            size="lg"
            fullWidth
            disabled={busy !== null}
            onClick={() => setAskOpen(false)}
          >
            Not sent — keep it here
          </Button>
          <Button
            variant="plain"
            size="lg"
            fullWidth
            loading={busy === "skip"}
            disabled={busy !== null}
            onClick={skip}
          >
            Skip this text
          </Button>
        </div>
      </Sheet>
    </article>
  );
}
