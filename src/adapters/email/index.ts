import "server-only";
import { newId } from "@/lib/ids";
import type { EmailProvider, SendResult } from "../messaging/types";
import { consoleEmailDriver } from "./console";
import { resendDriver } from "./resend";

// Email adapter (SPEC §9.1): `console` in development, `resend` when EMAIL_DRIVER=resend
// or RESEND_API_KEY is set.

export function emailDriverName(): "console" | "resend" {
  const d = process.env.EMAIL_DRIVER;
  if (d === "console" || d === "resend") return d;
  return process.env.RESEND_API_KEY ? "resend" : "console";
}

export function getEmail(): EmailProvider {
  return emailDriverName() === "resend" ? resendDriver : consoleEmailDriver;
}

/** Convenience for system mail (auth links). Features use enqueueMessage() instead. */
export async function sendSystemEmail(i: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  id?: string;
}): Promise<SendResult> {
  return getEmail().send({
    id: i.id ?? newId(),
    to: i.to,
    channel: "email",
    purpose: "internal",
    subject: i.subject,
    body: i.text,
    html: i.html,
  });
}
