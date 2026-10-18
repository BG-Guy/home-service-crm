// job_queue workers for `notify` (BUILD_PLAN §4, §8.2). Owner: B5.
// `push`: web push to every subscription of a user (prunes 404/410, critical types
// fall back to email when the user has no working subscription).
// `email`: one email through the email adapter (Resend over fetch, or console).

import { eq } from "drizzle-orm";
import { getEmail } from "@/adapters/email";
import { getPush } from "@/adapters/push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { emailHtml, emailText } from "@/features/messaging/email";
import { newId } from "@/lib/ids";
import { formatPhoneDisplay } from "@/lib/phone-display";
import type { JobQueueKind, Worker } from "@/lib/queue";
import { getCompany, getSettings } from "@/lib/settings";
import { unreadCount } from "./deliver";

/** Subscriptions failing this many times in a row are dropped. */
export const MAX_PUSH_FAILURES = 5;

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  kind?: string;
  id?: string;
}

async function sendEmail(p: EmailPayload): Promise<void> {
  if (!p.to) return;
  let html = p.html ?? null;
  let text = p.text;
  if (!html) {
    const [company, settings] = await Promise.all([
      getCompany(),
      getSettings(),
    ]);
    const layout = {
      subject: p.subject,
      text: p.text,
      companyName: settings.branding.app_name || company.name,
      companyPhone: formatPhoneDisplay(company.phone),
      accent: settings.branding.accent_color,
    };
    html = emailHtml(layout);
    text = emailText(layout);
  }
  const res = await getEmail().send({
    id: p.id ?? newId(),
    to: p.to,
    channel: "email",
    purpose: "internal",
    subject: p.subject,
    body: text,
    html,
  });
  if (res.status === "failed") {
    if (res.retryable) throw new Error(`email failed: ${res.error}`);
    console.warn(`[notify:email] permanent failure to ${p.to}: ${res.error}`);
  }
}

const push: Worker = async (payload) => {
  const p = payload as {
    userId: string;
    title: string;
    body?: string;
    url?: string;
    tag?: string;
    emailFallback?: EmailPayload | null;
  };
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, p.userId));
  if (subs.length === 0) {
    if (p.emailFallback) await sendEmail(p.emailFallback);
    return;
  }
  const badge = await unreadCount(p.userId);
  const provider = getPush();
  let ok = 0;
  let retry = 0;
  for (const sub of subs) {
    const r = await provider.send(sub, {
      title: p.title,
      body: p.body,
      url: p.url,
      tag: p.tag,
      badge,
    });
    if (r === "ok") {
      ok++;
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failedCount: 0 })
        .where(eq(pushSubscriptions.id, sub.id));
    } else if (r === "gone") {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, sub.id));
    } else {
      retry++;
      if (sub.failedCount + 1 >= MAX_PUSH_FAILURES)
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id));
      else
        await db
          .update(pushSubscriptions)
          .set({ failedCount: sub.failedCount + 1 })
          .where(eq(pushSubscriptions.id, sub.id));
    }
  }
  if (ok === 0 && retry === 0 && p.emailFallback) {
    // Every subscription was gone: treat as "push unavailable".
    await sendEmail(p.emailFallback);
    return;
  }
  if (ok === 0 && retry > 0) throw new Error("push delivery failed; retrying");
};

const email: Worker = async (payload) => {
  await sendEmail(payload as unknown as EmailPayload);
};

export const workers: Partial<Record<JobQueueKind, Worker>> = { push, email };
