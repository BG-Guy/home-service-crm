"use client";

import { MessageSquareReply, X } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextArea } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import {
  cancelScheduledSend,
  dismissOptoutFlag,
  logReply,
  stopTexting,
} from "../actions";

/** Cancel one scheduled / outbox send (thread + job panel). */
export function CancelScheduledButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        aria-label={`Cancel ${label}`}
        icon={<X aria-hidden size={14} />}
        loading={busy}
        onClick={async () => {
          const ok = await confirm({
            title: "Cancel this message?",
            message: `"${label}" won't be sent.`,
            confirmLabel: "Cancel message",
            cancelLabel: "Keep",
            destructive: true,
          });
          if (!ok) return;
          setBusy(true);
          const res = await cancelScheduledSend({ id });
          setBusy(false);
          if (res.ok) toast({ title: "Message canceled" });
          else
            toast({
              title: "Couldn't cancel",
              message: res.error,
              tone: "error",
            });
        }}
      >
        Cancel
      </Button>
      {dialog}
    </>
  );
}

/** "Customer replied: …" — link mode has no inbound driver, so the office logs it. */
export function LogReplyButton({
  customerId,
  jobId,
}: {
  customerId: string;
  jobId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const res = await logReply({ customerId, body, channel, jobId });
    setSaving(false);
    if (!res.ok) {
      toast({
        title: "Couldn't log the reply",
        message: res.error,
        tone: "error",
      });
      return;
    }
    toast({ title: "Reply logged", tone: "success" });
    setBody("");
    setOpen(false);
  };
  return (
    <>
      <Button
        variant="gray"
        size="sm"
        icon={<MessageSquareReply aria-hidden size={16} />}
        onClick={() => setOpen(true)}
      >
        Log reply
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Customer replied"
        detents={["content", "large"]}
        dirty={body.trim().length > 0}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            disabled={!body.trim() || saving}
            loading={saving}
            onClick={save}
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-6">
          <SegmentedControl
            label="Came in by"
            value={channel}
            segments={[
              { value: "sms", label: "Text" },
              { value: "email", label: "Email" },
            ]}
            onChange={setChannel}
          />
          <TextArea
            label="What they said"
            value={body}
            rows={4}
            autoFocus
            placeholder="C — see you tomorrow"
            onChange={(e) => setBody(e.currentTarget.value)}
          />
          <p className="px-1 text-footnote text-label-2">
            Replies like STOP, C (confirm) or R (reschedule) are applied
            automatically.
          </p>
        </div>
      </Sheet>
    </>
  );
}

/** Natural-language opt-out flagged for one-tap review (never auto-applied). */
export function OptoutReviewBanner({ customerId }: { customerId: string }) {
  const [busy, setBusy] = useState<null | "stop" | "keep">(null);
  return (
    <Banner
      tone="warning"
      title="Possible opt-out"
      action={
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            loading={busy === "stop"}
            disabled={busy !== null}
            onClick={async () => {
              setBusy("stop");
              const res = await stopTexting({ customerId });
              setBusy(null);
              if (res.ok) toast({ title: "Texting stopped", tone: "success" });
              else
                toast({
                  title: "Couldn't save",
                  message: res.error,
                  tone: "error",
                });
            }}
          >
            Stop texting
          </Button>
          <Button
            variant="gray"
            size="sm"
            loading={busy === "keep"}
            disabled={busy !== null}
            onClick={async () => {
              setBusy("keep");
              const res = await dismissOptoutFlag({ customerId });
              setBusy(null);
              if (!res.ok)
                toast({
                  title: "Couldn't save",
                  message: res.error,
                  tone: "error",
                });
            }}
          >
            Keep texting
          </Button>
        </div>
      }
    >
      Their last reply sounds like they want texts to stop. Review it before the
      next automated text.
    </Banner>
  );
}
