"use client";

import { Megaphone } from "lucide-react";
import { useState } from "react";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { ConfirmTyped } from "@/ui/components/ConfirmTyped";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { previewBulk, sendBulk } from "../actions";
import { smsSegments } from "../lint";

type Audience = "marketing" | "all_textable" | "recent_customers";

/**
 * Bulk text (messages.bulk_send): audience filter → live preview count → type the
 * count to confirm. Consent, quiet hours and caps still apply per recipient. Never
 * offered on review screens (SPEC M12).
 */
export function BulkSendButton() {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>("marketing");
  const [months, setMonths] = useState("12");
  const [purpose, setPurpose] = useState<"marketing" | "transactional">(
    "marketing",
  );
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{
    count: number;
    sample: string[];
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const check = async () => {
    setChecking(true);
    const res = await previewBulk({
      audience,
      months: audience === "recent_customers" ? Number(months) : undefined,
    });
    setChecking(false);
    if (res.ok && res.data) setPreview(res.data);
    else if (!res.ok)
      toast({ title: "Couldn't count", message: res.error, tone: "error" });
  };

  const seg = smsSegments(body);
  return (
    <>
      <Button
        variant="gray"
        size="sm"
        icon={<Megaphone aria-hidden size={16} />}
        onClick={() => setOpen(true)}
      >
        Bulk text
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Bulk text"
        detents={["large"]}
        dirty={body.length > 0}
        onClosed={() => setPreview(null)}
        leading={
          <Button variant="plain" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-8">
          <Banner tone="legal" title="Consent rules apply">
            Marketing texts only reach customers who agreed to marketing.
            Opted-out and do-not-text customers are always skipped, and texts
            wait for quiet hours to end.
          </Banner>
          <Select
            label="Who"
            value={audience}
            onChange={(e) => {
              setAudience(e.currentTarget.value as Audience);
              setPreview(null);
              if (e.currentTarget.value === "marketing")
                setPurpose("marketing");
            }}
            options={[
              { value: "marketing", label: "Customers with marketing consent" },
              { value: "recent_customers", label: "Customers served recently" },
              { value: "all_textable", label: "Everyone we can text" },
            ]}
          />
          {audience === "recent_customers" && (
            <TextField
              label="Served in the last (months)"
              inputMode="numeric"
              value={months}
              onChange={(e) => {
                setMonths(e.currentTarget.value.replace(/\D/g, ""));
                setPreview(null);
              }}
            />
          )}
          <SegmentedControl
            label="Kind of message"
            value={purpose}
            segments={[
              { value: "marketing", label: "Promotion" },
              {
                value: "transactional",
                label: "Service notice",
                disabled: audience === "marketing",
              },
            ]}
            onChange={setPurpose}
          />
          <div>
            <TextArea
              label="Message"
              value={body}
              rows={4}
              maxLength={480}
              placeholder="Storm warning: we're running emergency calls only today…"
              onChange={(e) => setBody(e.currentTarget.value)}
            />
            <p className="mt-1 px-1 text-right text-caption text-label-2">
              {seg.segments} segment{seg.segments === 1 ? "" : "s"}
              {purpose === "marketing"
                ? " · “Reply STOP to opt out” is added"
                : ""}
            </p>
          </div>
          {preview ? (
            <div className="rounded-card bg-card p-4 shadow-card">
              <p className="text-headline">{preview.count} recipients</p>
              <p className="text-footnote text-label-2">
                {preview.sample.join(", ")}
                {preview.count > preview.sample.length ? "…" : ""}
              </p>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="gray" onClick={check} loading={checking}>
              Preview count
            </Button>
            <Button
              variant="filled"
              className="flex-1"
              disabled={!preview || preview.count === 0 || !body.trim()}
              onClick={() => setConfirmOpen(true)}
            >
              Send to {preview?.count ?? "…"}
            </Button>
          </div>
        </div>
      </Sheet>
      {preview && (
        <ConfirmTyped
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Send to ${preview.count} customers?`}
          message="Type the number of recipients to confirm. This can't be undone."
          phrase={String(preview.count)}
          confirmLabel="Send"
          pendingLabel="Queuing…"
          onConfirm={async () => {
            const res = await sendBulk({
              audience,
              months:
                audience === "recent_customers" ? Number(months) : undefined,
              purpose,
              body,
              confirmCount: preview.count,
            });
            if (!res.ok) {
              toast({ title: "Not sent", message: res.error, tone: "error" });
              return;
            }
            toast({
              title: `${res.data?.queued ?? 0} texts queued`,
              message: "They appear in the outbox as they come due.",
              tone: "success",
            });
            setConfirmOpen(false);
            setOpen(false);
            setBody("");
          }}
        />
      )}
    </>
  );
}
