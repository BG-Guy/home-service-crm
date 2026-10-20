"use client";

import {
  ArrowUp,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Spinner } from "@/ui/components/Spinner";
import { toast } from "@/ui/components/Toast";
import { Toggle } from "@/ui/components/Toggle";
import { cx } from "@/ui/cx";
import { prepareTemplate, sendMessage } from "../actions";
import type { ComposerData, OutboxCard } from "../contracts";
import { reasonLabel } from "../labels";
import { smsSegments } from "../lint";
import { OutboxCardView } from "./OutboxCardView";

type Ch = "sms" | "whatsapp" | "email";

function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
}

/**
 * Message composer (S29): channel picker, template picker (rendered with live links),
 * GSM-7 segment counter, consent warning with a transactional manual override.
 * Link-mode texts come back as an outbox card the sender taps right here.
 */
export function Composer({
  data,
  jobId,
  leadId,
  defaultChannel,
  compact = false,
  autoFocus = false,
}: {
  data: ComposerData;
  jobId?: string;
  leadId?: string;
  defaultChannel?: Ch;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const fieldId = useId();
  const initial: Ch = (() => {
    const want = defaultChannel ?? data.preferredChannel;
    if (want === "email" && data.email) return "email";
    if (want === "whatsapp" && data.whatsappEnabled && data.phone)
      return "whatsapp";
    if (data.phone) return "sms";
    return data.email ? "email" : "sms";
  })();
  const [channel, setChannel] = useState<Ch>(initial);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [loadingTpl, setLoadingTpl] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [sending, setSending] = useState(false);
  const [card, setCard] = useState<OutboxCard | null>(null);

  const isText = channel !== "email";
  const locked = isText && !!data.textingLocked;
  const blockedText = isText && !data.canSms;
  const optedOut =
    data.smsStatus === "opted_out" || data.doNotText || data.doNotContact;
  const seg = useMemo(() => smsSegments(body), [body]);
  const templates = data.templates.filter((t) =>
    t.channels.includes(channel === "whatsapp" ? "sms" : channel),
  );

  if (data.doNotContact)
    return (
      <Banner tone="error" title="Do not contact">
        This customer asked not to be contacted. Messages are blocked.
      </Banner>
    );

  const pickTemplate = async (key: string) => {
    setLoadingTpl(key);
    const res = await prepareTemplate({
      customerId: data.customerId,
      jobId,
      leadId,
      templateKey: key,
      channel,
    });
    setLoadingTpl(null);
    if (!res.ok) {
      toast({
        title: "Couldn't load the template",
        message: res.error,
        tone: "error",
      });
      return;
    }
    setTemplateKey(key);
    setBody(res.data?.body ?? "");
    if (channel === "email") setSubject(res.data?.subject ?? "");
  };

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    const res = await sendMessage({
      customerId: data.customerId,
      jobId,
      leadId,
      channel,
      templateKey: templateKey ?? undefined,
      body,
      subject: channel === "email" ? subject || undefined : undefined,
      manualOverride: blockedText && override ? true : undefined,
      clientId: newClientId(),
    });
    setSending(false);
    if (!res.ok) {
      toast({ title: "Not sent", message: res.error, tone: "error" });
      return;
    }
    const r = res.data;
    if (!r) return;
    if (r.status === "pending_tap" && r.to) {
      setCard({
        id: r.scheduledMessageId,
        customerId: data.customerId,
        customerName: data.customerName,
        jobId: jobId ?? null,
        jobNumber: null,
        to: r.to,
        channel: r.channel === "whatsapp" ? "whatsapp" : "sms",
        body: r.body,
        templateKey: templateKey ?? "manual",
        templateLabel: "Your message",
        dueAt: new Date().toISOString(),
        expiresAt: null,
        assignedUserId: null,
        assignedName: null,
        purpose: "transactional",
      });
    } else if (r.status === "scheduled" || r.status === "sent") {
      toast({
        title: channel === "email" ? "Email on its way" : "Message sent",
        tone: "success",
      });
    } else if (r.status === "deferred_quiet") {
      toast({
        title: "Queued for the morning",
        message: reasonLabel(r.reason) ?? undefined,
      });
    } else {
      toast({
        title: "Not sent",
        message: reasonLabel(r.reason) ?? "This message can't go out.",
        tone: "error",
      });
      return;
    }
    setBody("");
    setSubject("");
    setTemplateKey(null);
    setOverride(false);
  };

  if (card)
    return (
      <div className="flex flex-col gap-2">
        <p className="px-1 text-footnote text-label-2">
          Tap Send to open your Messages app with the text filled in.
        </p>
        <OutboxCardView
          card={card}
          linkDelimiter={data.linkDelimiter}
          onDone={() => setCard(null)}
          emphasized
        />
      </div>
    );

  const channelSegments = [
    {
      value: "sms" as const,
      label: (
        <span className="inline-flex items-center gap-1">
          <MessageSquare aria-hidden size={14} /> Text
        </span>
      ),
      disabled: !data.phone,
    },
    ...(data.whatsappEnabled
      ? [
          {
            value: "whatsapp" as const,
            label: (
              <span className="inline-flex items-center gap-1">
                <MessageCircle aria-hidden size={14} /> WhatsApp
              </span>
            ),
            disabled: !data.phone,
          },
        ]
      : []),
    {
      value: "email" as const,
      label: (
        <span className="inline-flex items-center gap-1">
          <Mail aria-hidden size={14} /> Email
        </span>
      ),
      disabled: !data.email,
    },
  ];

  const disabled =
    !body.trim() ||
    sending ||
    locked ||
    (blockedText && !override) ||
    (channel === "email" && !data.email);
  const channelsOn = channelSegments.filter((c) => !c.disabled);
  const nextChannel =
    channelsOn[
      (channelsOn.findIndex((c) => c.value === channel) + 1) % channelsOn.length
    ]?.value ?? channel;
  const channelName = (c: Ch) =>
    c === "email" ? "email" : c === "whatsapp" ? "WhatsApp" : "text";
  const ChannelIcon =
    channel === "email"
      ? Mail
      : channel === "whatsapp"
        ? MessageCircle
        : MessageSquare;

  const banners = (
    <>
      {locked && (
        <Banner tone="info" title="Texting opens near the visit">
          You can text this customer from 2 hours before your visit until a day
          after. Email works any time.
        </Banner>
      )}

      {blockedText && !locked && (
        <Banner
          tone="warning"
          title={optedOut ? "Opted out of texts" : "No permission to text"}
        >
          <p>
            {optedOut
              ? "This customer asked us to stop texting. Only send a reply they asked for."
              : "This customer hasn't agreed to texts yet."}{" "}
            Email is always an option
            {data.email ? "" : " once you add an address"}.
          </p>
          {data.phone && !data.doNotContact && (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant
            <label className="mt-2 flex min-h-11 items-center justify-between gap-3">
              <span className="text-subhead">
                Send this one reply anyway (not marketing)
              </span>
              <Toggle
                label="Send anyway"
                checked={override}
                onChange={(e) => setOverride(e.currentTarget.checked)}
              />
            </label>
          )}
        </Banner>
      )}
    </>
  );

  const templateChips = templates.length > 0 && (
    <ChipRow label="Templates">
      {templates.map((t) => (
        <Chip
          key={t.key}
          selected={templateKey === t.key}
          onClick={() => pickTemplate(t.key)}
        >
          {loadingTpl === t.key ? "Loading…" : t.label}
        </Chip>
      ))}
    </ChipRow>
  );

  const onBody = (v: string) => {
    setBody(v);
    // Hand-edited text is the person's own message, not the template: the
    // template's send-time rules (job still booked…) no longer apply (T2-08).
    if (templateKey) setTemplateKey(null);
  };

  // Compact = the thread's pill composer (iMessage): channel switch, a growing
  // pill field and a round send button inside it.
  if (compact) {
    const lines = Math.min(
      6,
      Math.max(1, body.split("\n").length, Math.ceil(body.length / 38)),
    );
    return (
      <div className="flex flex-col gap-2">
        {banners}
        {templateChips}
        {channel === "email" && (
          <TextField
            label="Subject"
            hideLabel
            value={subject}
            onChange={(e) => setSubject(e.currentTarget.value)}
            placeholder="Subject"
          />
        )}
        <div className="flex items-end gap-2">
          {channelsOn.length > 1 ? (
            <IconButton
              label={`Sending by ${channelName(channel)}. Switch to ${channelName(nextChannel)}`}
              variant="secondary"
              size={40}
              className="mb-0.5 shrink-0"
              onClick={() => {
                setChannel(nextChannel);
                setTemplateKey(null);
              }}
            >
              <ChannelIcon aria-hidden size={19} />
            </IconButton>
          ) : null}
          <div className="relative min-w-0 flex-1">
            <textarea
              id={fieldId}
              aria-label="Message"
              value={body}
              rows={lines}
              // biome-ignore lint/a11y/noAutofocus: opt-in prop (the thread opened to reply)
              autoFocus={autoFocus}
              maxLength={1600}
              placeholder={`${channel === "email" ? "Email" : "Message"} ${data.customerName.split(" ")[0] ?? ""}`}
              onChange={(e) => onBody(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  (e.metaKey || e.ctrlKey) &&
                  !disabled
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="block max-h-40 min-h-11 w-full resize-none rounded-[22px] border-[0.5px] border-sep bg-field py-[10px] pr-12 pl-4 text-body text-label placeholder:text-label-3 outline-none transition-shadow [field-sizing:content] focus-visible:shadow-[0_0_0_2px_var(--accent)]"
            />
            <IconButton
              label={channel === "email" ? "Send email" : "Send text"}
              variant="primary"
              size={30}
              className="!absolute right-[7px] bottom-[7px] transition-transform data-[off]:scale-90 disabled:!bg-fill disabled:!text-label-3 disabled:!opacity-100"
              disabled={disabled}
              data-off={disabled ? "" : undefined}
              onClick={send}
            >
              {sending ? (
                <Spinner size={16} />
              ) : (
                <ArrowUp aria-hidden size={18} strokeWidth={2.75} />
              )}
            </IconButton>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-2 text-caption text-label-2">
          <span className="truncate">
            {isText
              ? `${channel === "whatsapp" ? "WhatsApp" : "Text"} to ${data.phone ? formatPhoneDisplay(data.phone) : "no number"}`
              : `Email to ${data.email ?? "no email"}`}
          </span>
          {isText && body && (
            <span
              className={cx(
                "num shrink-0",
                seg.encoding === "UCS-2" && "text-warning",
              )}
            >
              {body.length} · {seg.segments} segment
              {seg.segments === 1 ? "" : "s"}
              {seg.encoding === "UCS-2" ? " (emoji)" : ""}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col", compact ? "gap-2" : "gap-3")}>
      <SegmentedControl
        label="Channel"
        value={channel}
        segments={channelSegments}
        onChange={(v) => {
          setChannel(v);
          setTemplateKey(null);
        }}
      />

      {locked && (
        <Banner tone="info" title="Texting opens near the visit">
          You can text this customer from 2 hours before your visit until a day
          after. Email works any time.
        </Banner>
      )}

      {blockedText && !locked && (
        <Banner
          tone="warning"
          title={optedOut ? "Opted out of texts" : "No permission to text"}
        >
          <p>
            {optedOut
              ? "This customer asked us to stop texting. Only send a reply they asked for."
              : "This customer hasn't agreed to texts yet."}{" "}
            Email is always an option
            {data.email ? "" : " once you add an address"}.
          </p>
          {data.phone && !data.doNotContact && (
            // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant
            <label className="mt-2 flex min-h-11 items-center justify-between gap-3">
              <span className="text-subhead">
                Send this one reply anyway (not marketing)
              </span>
              <Toggle
                label="Send anyway"
                checked={override}
                onChange={(e) => setOverride(e.currentTarget.checked)}
              />
            </label>
          )}
        </Banner>
      )}

      {templates.length > 0 && (
        <ChipRow label="Templates">
          {templates.map((t) => (
            <Chip
              key={t.key}
              selected={templateKey === t.key}
              onClick={() => pickTemplate(t.key)}
            >
              {loadingTpl === t.key ? "Loading…" : t.label}
            </Chip>
          ))}
        </ChipRow>
      )}

      {channel === "email" && (
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          placeholder={`Message from your service team`}
        />
      )}

      <div>
        <TextArea
          id={fieldId}
          label="Message"
          hideLabel={compact}
          value={body}
          rows={compact ? 3 : 4}
          autoFocus={autoFocus}
          placeholder={`Message ${data.customerName.split(" ")[0] ?? ""}`}
          onChange={(e) => {
            setBody(e.currentTarget.value);
            // Hand-edited text is the person's own message, not the template: the
            // template's send-time rules (job still booked…) no longer apply (T2-08).
            if (templateKey) setTemplateKey(null);
          }}
          maxLength={1600}
        />
        <div className="mt-1 flex items-center justify-between px-1 text-caption text-label-2">
          <span>
            {isText
              ? `To ${data.phone ? formatPhoneDisplay(data.phone) : "no number"}`
              : `To ${data.email ?? "no email"}`}
          </span>
          {isText && body && (
            <span className={cx(seg.encoding === "UCS-2" && "text-warning")}>
              {body.length} chars · {seg.segments} segment
              {seg.segments === 1 ? "" : "s"}
              {seg.encoding === "UCS-2" ? " (emoji)" : ""}
            </span>
          )}
        </div>
      </div>

      <Button
        variant="primary"
        icon={<Send aria-hidden size={18} />}
        loading={sending}
        disabled={
          !body.trim() ||
          sending ||
          locked ||
          (blockedText && !override) ||
          (channel === "email" && !data.email)
        }
        onClick={send}
        fullWidth={!compact}
      >
        {channel === "email" ? "Send email" : "Send text"}
      </Button>
    </div>
  );
}
