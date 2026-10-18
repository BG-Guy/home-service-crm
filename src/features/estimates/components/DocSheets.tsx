"use client";

import { Copy, Mail, MessageSquare, Send, Share2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/ui/components/Button";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";

// Sheets shared by the estimate builder and the change-order screen: send (text,
// email, share link), verbal approval (who + note) and decline (reason).

export type SendChannel = "customer_preferred" | "sms" | "email" | "link";
type SendResult =
  | { ok: true; data?: { url: string; status: string } }
  | { ok: false; error: string };

export function SendDocSheet({
  open,
  onClose,
  title,
  blurb,
  send,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  blurb: string;
  send: (channel: SendChannel) => Promise<SendResult>;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const run = (channel: SendChannel) =>
    start(async () => {
      const r = await send(channel);
      if (!r.ok) return void toast({ title: r.error, tone: "error" });
      const link = r.data?.url ?? null;
      setUrl(link);
      if (channel === "link" && link) {
        try {
          if (navigator.share) await navigator.share({ title, url: link });
          else {
            await navigator.clipboard.writeText(link);
            toast({ title: "Link copied", tone: "success" });
          }
        } catch {
          /* share cancelled */
        }
        return;
      }
      toast({
        title:
          r.data?.status === "pending_tap"
            ? "Ready in your outbox — tap to send"
            : "Sent",
        tone: "success",
      });
    });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      detents={["content"]}
      trailing={
        <Button variant="plain" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <p className="px-1 text-subhead text-label-2">{blurb}</p>
        <ListSection>
          <ListRow
            icon={<Send size={17} />}
            title="Preferred channel"
            subtitle="Text or email, whichever they chose"
            onClick={() => run("customer_preferred")}
            disabled={pending}
          />
          <ListRow
            icon={<MessageSquare size={17} />}
            iconTone="green"
            title="Text message"
            onClick={() => run("sms")}
            disabled={pending}
          />
          <ListRow
            icon={<Mail size={17} />}
            iconTone="blue"
            title="Email"
            onClick={() => run("email")}
            disabled={pending}
          />
          <ListRow
            icon={<Share2 size={17} />}
            iconTone="gray"
            title="Share or copy link"
            subtitle="Marks it as sent"
            onClick={() => run("link")}
            disabled={pending}
          />
        </ListSection>
        {url ? (
          <div className="flex items-center gap-2 rounded-card bg-card px-3 py-2 shadow-card">
            <span className="min-w-0 flex-1 truncate text-footnote text-label-2">
              {url}
            </span>
            <IconButton
              label="Copy link"
              size={36}
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast({ title: "Link copied", tone: "success" }))
              }
            >
              <Copy size={18} />
            </IconButton>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

type Plain = { ok: true } | { ok: false; error: string };

export function VerbalApprovalSheet({
  open,
  onClose,
  defaultName,
  summary,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  summary: string;
  submit: (v: { signerName: string; note: string }) => Promise<Plain>;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Approve on behalf"
      detents={["large"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
      footer={
        <div className="px-[var(--gutter)] pb-2 pt-2">
          <Button
            size="lg"
            fullWidth
            loading={pending}
            disabled={name.trim().length < 2 || note.trim().length < 5}
            onClick={() =>
              start(async () => {
                const r = await submit({ signerName: name, note });
                if (r.ok) {
                  toast({ title: "Approved (verbal)", tone: "success" });
                  onClose();
                } else toast({ title: r.error, tone: "error" });
              })
            }
          >
            Record verbal approval
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <div className="rounded-card bg-[color-mix(in_srgb,var(--sys-orange)_14%,transparent)] p-4 text-subhead">
          A verbal approval has no signature. It is logged with your name, it
          raises the job's dispute risk, and the customer should still sign
          before work starts when possible.
        </div>
        <p className="px-1 text-subhead text-label-2">{summary}</p>
        <TextField
          label="Who approved"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          autoComplete="off"
        />
        <TextArea
          label="How and when"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          rows={3}
          placeholder="e.g. Called 2:15 PM, approved option 2 incl. tax"
        />
      </div>
    </Sheet>
  );
}

export function DeclineSheet({
  open,
  onClose,
  title,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submit: (reason: string) => Promise<Plain>;
}) {
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      detents={["content"]}
      leading={
        <Button variant="plain" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-[var(--gutter)] pb-6">
        <TextArea
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          rows={3}
          placeholder="Price, timing, going with someone else…"
        />
        <Button
          variant="destructive"
          size="lg"
          fullWidth
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await submit(reason);
              if (r.ok) {
                toast({ title: "Marked declined", tone: "success" });
                onClose();
              } else toast({ title: r.error, tone: "error" });
            })
          }
        >
          Mark declined
        </Button>
      </div>
    </Sheet>
  );
}
