import {
  Bell,
  Bot,
  CreditCard,
  HardDrive,
  Mail,
  MapPinned,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { aiProviderName } from "@/adapters/ai";
import { emailDriverName } from "@/adapters/email";
import { smsDriverName } from "@/adapters/messaging";
import { paymentsDriverName } from "@/adapters/payments";
import { vapidPublicKey } from "@/adapters/push";
import { storageDriverName } from "@/adapters/storage";
import {
  CopyRow,
  SecretRow,
  type SecretStatus,
  TestRow,
} from "@/features/settings/components/Integrations";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { requireUser } from "@/lib/auth/current";
import { appUrl } from "@/lib/env";
import { listSecretStatus } from "@/lib/secrets";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import type { Tone } from "@/ui/tone";

export const metadata: Metadata = { title: "Integrations" };

const LABELS: Record<SecretStatus["key"], { label: string; hint?: string }> = {
  STRIPE_SECRET_KEY: {
    label: "Stripe secret key",
    hint: "sk_live_… or rk_live_…",
  },
  STRIPE_WEBHOOK_SECRET: { label: "Stripe webhook secret", hint: "whsec_…" },
  RESEND_API_KEY: { label: "Resend API key", hint: "re_…" },
  EMAIL_FROM: { label: "From address", hint: "Acme <jobs@acme.com>" },
  GEMINI_API_KEY: {
    label: "Gemini API key",
    hint: "For receipt and odometer reading",
  },
  S3_ACCESS_KEY_ID: { label: "S3 access key ID" },
  S3_SECRET_ACCESS_KEY: { label: "S3 secret access key" },
  TURNSTILE_SECRET: {
    label: "Turnstile secret",
    hint: "Spam protection on the hosted lead form",
  },
  VAPID_PRIVATE_KEY: {
    label: "VAPID private key",
    hint: "From npm run gen:vapid",
  },
};

function Driver({
  icon,
  tone,
  title,
  driver,
  active,
  env,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  driver: string;
  active: boolean;
  env: string;
}) {
  return (
    <ListRow
      icon={icon}
      iconTone={tone}
      title={title}
      subtitle={env}
      detail={
        <Pill tone={active ? "green" : "gray"} size="sm">
          {driver}
        </Pill>
      }
    />
  );
}

// Settings → Integrations (SPEC M21): which provider driver is active (chosen by env
// vars, §9.7), write-only credentials (env wins; last 4 only), test buttons and the
// VAPID public key.
export default async function SettingsIntegrationsPage() {
  await requireUser("settings.integrations");
  const status = await listSecretStatus();
  const by = new Map(status.map((s) => [s.key, s]));
  const secret = (key: SecretStatus["key"]): SecretStatus => {
    const s = by.get(key);
    return {
      key,
      label: LABELS[key].label,
      hint: LABELS[key].hint,
      source: s?.source ?? "none",
      last4: s?.last4 ?? null,
    };
  };
  const pay = paymentsDriverName();
  const email = emailDriverName();
  const sms = smsDriverName();
  const ai = aiProviderName();
  const storage = storageDriverName();
  const vapid = vapidPublicKey();
  const geocoder = process.env.GEOCODER || "census";
  const tiles = !!process.env.NEXT_PUBLIC_TILE_URL;
  const turnstile = (by.get("TURNSTILE_SECRET")?.source ?? "none") !== "none";

  return (
    <SettingsScreen
      title="Integrations"
      intro="Providers are picked by server environment variables; credentials can live there or be saved here (encrypted). A value set in the environment always wins."
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <ListSection
          header="Card payments"
          footer={
            pay === "stripe"
              ? "Point a Stripe webhook at the URL above (events: payment_intent.*, charge.*, checkout.session.*)."
              : "Manual payments (cash, check, Zelle, Venmo) always work. Set PAYMENTS_DRIVER=stripe to take cards."
          }
        >
          <Driver
            icon={<CreditCard size={17} aria-hidden />}
            tone="indigo"
            title="Processor"
            driver={pay === "stripe" ? "Stripe" : "Manual only"}
            active={pay === "stripe"}
            env="PAYMENTS_DRIVER"
          />
          <SecretRow s={secret("STRIPE_SECRET_KEY")} />
          <SecretRow s={secret("STRIPE_WEBHOOK_SECRET")} />
          <CopyRow label="Webhook URL" value={appUrl("/api/webhooks/stripe")} />
        </ListSection>

        <ListSection
          header="Email"
          footer={
            email === "console"
              ? "Development mode: emails are printed to the server log instead of sent. Set EMAIL_DRIVER=resend with an API key to deliver."
              : undefined
          }
        >
          <Driver
            icon={<Mail size={17} aria-hidden />}
            tone="blue"
            title="Email driver"
            driver={email === "resend" ? "Resend" : "Console (dev)"}
            active={email === "resend"}
            env="EMAIL_DRIVER, RESEND_API_KEY"
          />
          <SecretRow s={secret("RESEND_API_KEY")} />
          <SecretRow s={secret("EMAIL_FROM")} />
          <TestRow kind="email" label="Send me a test email" />
        </ListSection>

        <ListSection
          header="Text messages"
          footer="Link mode (default) opens a ready-to-send text on the sender's phone — no SMS provider or 10DLC registration needed. Automated sending needs a provider driver."
        >
          <Driver
            icon={<MessageSquare size={17} aria-hidden />}
            tone="green"
            title="SMS driver"
            driver={sms === "link" ? "Link mode" : sms}
            active
            env="MESSAGING_SMS_DRIVER"
          />
        </ListSection>

        <ListSection
          header="Push notifications"
          footer="Generate keys with npm run gen:vapid, set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, then enable push from the installed app on each phone."
        >
          <Driver
            icon={<Bell size={17} aria-hidden />}
            tone="red"
            title="Web Push"
            driver={vapid ? "Configured" : "Off"}
            active={!!vapid}
            env="VAPID_PUBLIC_KEY, VAPID_SUBJECT"
          />
          {vapid && <CopyRow label="VAPID public key" value={vapid} />}
          <SecretRow s={secret("VAPID_PRIVATE_KEY")} />
          <TestRow kind="push" label="Send me a test notification" />
        </ListSection>

        <ListSection header="File storage">
          <Driver
            icon={<HardDrive size={17} aria-hidden />}
            tone="gray"
            title="Photos and documents"
            driver={storage === "s3" ? "S3 / R2" : "Local disk"}
            active
            env="STORAGE_DRIVER, S3_BUCKET, S3_ENDPOINT"
          />
          <SecretRow s={secret("S3_ACCESS_KEY_ID")} />
          <SecretRow s={secret("S3_SECRET_ACCESS_KEY")} />
          <TestRow
            kind="storage"
            label="Test storage"
            subtitle="Writes, reads and deletes a tiny file"
          />
        </ListSection>

        <ListSection
          header="AI assist"
          footer="Used for reading receipts, odometers and tool labels. Customer details are never sent on the free tier."
        >
          <Driver
            icon={<Bot size={17} aria-hidden />}
            tone="purple"
            title="AI provider"
            driver={ai === "gemini" ? "Gemini" : "Off"}
            active={ai === "gemini"}
            env="AI_PROVIDER, GEMINI_TIER, AI_DAILY_BUDGET"
          />
          <SecretRow s={secret("GEMINI_API_KEY")} />
        </ListSection>

        <ListSection header="Maps and addresses">
          <Driver
            icon={<MapPinned size={17} aria-hidden />}
            tone="teal"
            title="Geocoder"
            driver={geocoder}
            active={geocoder !== "none"}
            env="GEOCODER (census | nominatim | none)"
          />
          <TestRow
            kind="geocode"
            label="Test address lookup"
            subtitle="Looks up a known US address"
          />
          <Driver
            icon={<MapPinned size={17} aria-hidden />}
            tone="teal"
            title="Map tiles"
            driver={tiles ? "Custom" : "OSM (dev only)"}
            active={tiles}
            env="NEXT_PUBLIC_TILE_URL"
          />
        </ListSection>

        <ListSection header="Lead form spam">
          <Driver
            icon={<ShieldCheck size={17} aria-hidden />}
            tone="orange"
            title="Cloudflare Turnstile"
            driver={turnstile ? "On" : "Off"}
            active={turnstile}
            env="TURNSTILE_SECRET, NEXT_PUBLIC_TURNSTILE_SITE_KEY"
          />
          <SecretRow s={secret("TURNSTILE_SECRET")} />
        </ListSection>
      </div>
    </SettingsScreen>
  );
}
