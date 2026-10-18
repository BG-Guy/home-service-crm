import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { emailDriverName } from "@/adapters/email";
import { getSmsDriver, smsDriverName } from "@/adapters/messaging";
import { pushEnabled } from "@/adapters/push";
import { db } from "@/db";
import { users } from "@/db/schema";
import { MessagingSettingsForm } from "@/features/messaging/components/MessagingSettingsForm";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { requireUser } from "@/lib/auth/current";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Messaging" };

const DRIVER_LABELS: Record<string, string> = {
  link: "Free — tap to send (Outbox)",
  console: "Console (development)",
  android_gateway: "Android gateway",
  twilio: "Twilio",
  telnyx: "Telnyx",
};

// Settings → Messaging (SPEC M12): driver, outbox owners, tech_texts_from, link
// format (+ per-device override and "send test to myself"), WhatsApp, email name,
// reply phone and team-alert timing.
export default async function SettingsMessagingPage() {
  const user = await requireUser("settings.manage");
  const [s, me] = await Promise.all([
    getSettings(),
    db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ]);
  const name = smsDriverName();
  let autoSend = false;
  try {
    autoSend = (await getSmsDriver(name)).caps.autoSend;
  } catch {
    autoSend = false;
  }
  return (
    <PushedScreen
      title="Messaging"
      intro="How texts and emails reach your customers and team."
    >
      <MessagingSettingsForm
        initial={{
          tech_texts_from: s.messaging.tech_texts_from,
          link_delimiter: s.messaging.link_delimiter,
          whatsapp_enabled: s.messaging.whatsapp_enabled,
          email_from_name: s.messaging.email_from_name,
          reply_phone: s.messaging.reply_phone
            ? formatPhoneDisplay(s.messaging.reply_phone)
            : null,
          outbox_owner_by_template: s.messaging.outbox_owner_by_template,
          daily_digest_time: s.notify.daily_digest_time,
          approval_batch_minutes: s.notify.approval_batch_minutes,
        }}
        smsDriver={DRIVER_LABELS[name] ?? name}
        smsAutoSend={autoSend}
        emailDriver={
          emailDriverName() === "resend" ? "Resend" : "Console (development)"
        }
        pushReady={pushEnabled()}
        quietHours={s.compliance.quiet_hours}
        myPhone={me[0]?.phone ?? null}
      />
    </PushedScreen>
  );
}
