"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  getSmsSeparatorOverride,
  type SmsSeparator,
  setSmsSeparatorOverride,
  smsHref,
} from "@/client/sms-href";
import { SaveBar } from "@/features/settings/components/SaveBar";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Select, TextField } from "@/ui/components/Field";
import { ListRow, ListSection } from "@/ui/components/List";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";
import { saveMessagingSettings } from "../actions";
import { templateLabel } from "../labels";

export interface MessagingSettingsInitial {
  tech_texts_from: "tech_phone" | "office_outbox";
  link_delimiter: "auto" | SmsSeparator;
  whatsapp_enabled: boolean;
  email_from_name: string | null;
  reply_phone: string | null;
  outbox_owner_by_template: Record<string, "tech" | "office">;
  daily_digest_time: string;
  approval_batch_minutes: number;
}

/** Templates whose outbox owner can be chosen (link mode). */
const OWNER_KEYS = [
  "job.on_my_way",
  "job.running_late",
  "job.reminder_2h",
  "job.reminder_24h",
  "job.booked",
  "review.request",
  "invoice.reminder_1",
  "estimate.followup_1",
];

const DELIMS: { value: "auto" | SmsSeparator; label: string }[] = [
  { value: "auto", label: "Automatic (by phone type)" },
  { value: "&", label: "sms:…&body= (iPhone)" },
  { value: "?", label: "sms:…?body= (Android)" },
  { value: "?&", label: "sms:…?&body= (both)" },
];

export function MessagingSettingsForm({
  initial,
  smsDriver,
  smsAutoSend,
  emailDriver,
  pushReady,
  quietHours,
  myPhone,
}: {
  initial: MessagingSettingsInitial;
  smsDriver: string;
  smsAutoSend: boolean;
  emailDriver: string;
  pushReady: boolean;
  quietHours: { start: string; end: string };
  myPhone: string | null;
}) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [device, setDevice] = useState<SmsSeparator | "default">(
    () => getSmsSeparatorOverride() ?? "default",
  );
  const set = <K extends keyof MessagingSettingsInitial>(
    k: K,
    val: MessagingSettingsInitial[K],
  ) => setV((p) => ({ ...p, [k]: val }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const save = async () => {
    setSaving(true);
    const res = await saveMessagingSettings({
      ...v,
      email_from_name: v.email_from_name || null,
      reply_phone: v.reply_phone || null,
    });
    setSaving(false);
    if (res.ok) {
      setErrors({});
      toast({ title: "Messaging settings saved", tone: "success" });
    } else {
      setErrors(res.fieldErrors ?? {});
      toast({ title: "Couldn't save", message: res.error, tone: "error" });
    }
  };

  const testToMe = () => {
    if (!myPhone) return;
    const sep =
      device !== "default"
        ? device
        : v.link_delimiter !== "auto"
          ? v.link_delimiter
          : undefined;
    window.location.href = smsHref(
      myPhone,
      "Test from your CRM: if this text is filled in, sms links work on this phone.",
      undefined,
      sep,
    );
  };

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <ListSection
        header="Text messages"
        footer={
          smsAutoSend
            ? "Texts send automatically through your SMS provider."
            : "Free mode: texts wait in the Outbox and open your phone's Messages app with the words filled in. A person taps Send."
        }
      >
        <ListRow title="SMS driver" detail={smsDriver} />
        <ListRow title="Email" detail={emailDriver} />
        <ListRow
          title="Push notifications"
          detail={pushReady ? "Ready" : "Not set up"}
        />
      </ListSection>

      <ListSection header="Who sends job-day texts">
        <div className="flex flex-col gap-3 px-4 py-3">
          <SegmentedControl
            label="Tech texts come from"
            value={v.tech_texts_from}
            segments={[
              { value: "tech_phone", label: "Tech's phone" },
              { value: "office_outbox", label: "Office outbox" },
            ]}
            onChange={(x) => set("tech_texts_from", x)}
          />
          {v.tech_texts_from === "tech_phone" ? (
            <Banner tone="info">
              On-my-way and running-late texts land in the tech&apos;s own
              outbox and go out from their phone. Customers may text them back
              directly.
            </Banner>
          ) : (
            <Banner tone="info">
              All customer texts wait in the office outbox. Techs never share
              their personal number.
            </Banner>
          )}
        </div>
      </ListSection>

      <ListSection
        header="Outbox owner by message"
        footer="Who taps Send for each kind of text in free mode."
      >
        {OWNER_KEYS.map((k) => (
          <ListRow
            key={k}
            title={templateLabel(k)}
            detail={
              <SegmentedControl
                label={`${templateLabel(k)} owner`}
                value={v.outbox_owner_by_template[k] ?? "office"}
                segments={[
                  { value: "tech", label: "Tech" },
                  { value: "office", label: "Office" },
                ]}
                onChange={(x) =>
                  set("outbox_owner_by_template", {
                    ...v.outbox_owner_by_template,
                    [k]: x,
                  })
                }
                className="w-[150px]"
              />
            }
          />
        ))}
      </ListSection>

      <ListSection header="Links and channels">
        <div className="flex flex-col gap-3 px-4 py-3">
          <Select
            label="Text link format (company default)"
            value={v.link_delimiter}
            options={DELIMS}
            onChange={(e) =>
              set(
                "link_delimiter",
                e.currentTarget.value as "auto" | SmsSeparator,
              )
            }
          />
        </div>
        <ToggleRow
          title="WhatsApp"
          subtitle="Offer WhatsApp (wa.me links) in the composer"
          checked={v.whatsapp_enabled}
          onChange={(e) => set("whatsapp_enabled", e.currentTarget.checked)}
        />
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <TextField
            label="Email from name"
            value={v.email_from_name ?? ""}
            placeholder="Acme Home Services"
            onChange={(e) => set("email_from_name", e.currentTarget.value)}
          />
          <TextField
            label="Reply phone shown in texts"
            value={v.reply_phone ?? ""}
            inputMode="tel"
            type="tel"
            autoComplete="tel"
            placeholder="(512) 555-0100"
            error={errors.reply_phone}
            onChange={(e) => set("reply_phone", e.currentTarget.value)}
          />
        </div>
      </ListSection>

      <ListSection header="Team alerts">
        <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
          <TextField
            label="Daily digest time"
            type="time"
            value={v.daily_digest_time}
            onChange={(e) => set("daily_digest_time", e.currentTarget.value)}
          />
          <Select
            label="Batch approval alerts every"
            value={String(v.approval_batch_minutes)}
            options={[5, 10, 15, 30, 60].map((n) => ({
              value: String(n),
              label: `${n} minutes`,
            }))}
            onChange={(e) =>
              set("approval_batch_minutes", Number(e.currentTarget.value))
            }
          />
        </div>
      </ListSection>

      <ListSection
        header="Quiet hours"
        footer="Automated customer texts only go out inside this window, in the customer's time zone. Edit it in Compliance."
      >
        <ListRow
          title="Allowed window"
          detail={`${quietHours.start} – ${quietHours.end}`}
          href="/settings/compliance"
        />
      </ListSection>

      <ListSection
        header="This device"
        footer="If texts open without the words filled in, try another format here. Saved on this device only."
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <Select
            label="Text link format on this device"
            value={device}
            options={[
              { value: "default", label: "Use the company default" },
              ...DELIMS.filter((d) => d.value !== "auto").map((d) => ({
                value: d.value,
                label: d.label,
              })),
            ]}
            onChange={(e) => {
              const val = e.currentTarget.value as SmsSeparator | "default";
              setDevice(val);
              setSmsSeparatorOverride(val === "default" ? null : val);
            }}
          />
          <Button
            variant="gray"
            icon={<Send aria-hidden size={16} />}
            disabled={!myPhone}
            onClick={testToMe}
          >
            Send a test to myself
          </Button>
          {!myPhone && (
            <p className="text-footnote text-label-2">
              Add your mobile number in{" "}
              <Link href="/settings/profile" className="text-accent-text">
                your profile
              </Link>{" "}
              to test.
            </p>
          )}
        </div>
      </ListSection>

      <SaveBar dirty={dirty} pending={saving} disabled={!dirty} onSave={save} />
    </div>
  );
}
