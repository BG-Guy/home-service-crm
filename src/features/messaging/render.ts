import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { estimates } from "@/db/schema";
import {
  buildTemplateContext,
  type ContextRef,
  loadFacts,
} from "@/features/automations/context";
import {
  extractVariables,
  renderWithReport,
  type TemplateContext,
} from "@/lib/template";
import type { EntityRef } from "@/lib/types";
import { recipientTimeZone } from "./compliance";
import { tidyEmailText } from "./email";
import { findTemplate } from "./sender";

// Render a template for a real customer/job outside the sender: the composer's
// template picker (real links minted, the person then edits and sends), the template
// editor's live preview and "Preview with a real job" (no minting: placeholder links).

/** Collapse runs of spaces/tabs (empty optional variables) without touching newlines. */
export function collapseSpaces(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

// ------------------------------------------------------------------ composer context

const TAG =
  /\{\{\s*([A-Za-z_][\w.]*)\s*(?::\s*[a-z_][a-z0-9_]*\s*)?(\|[^}]*)?\}\}/g;

/**
 * Variables a text can't do without: no `|fallback`, and not an optional `*_line`
 * (service-fee line, emergency line… are empty by design).
 */
export function requiredVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(TAG)) {
    const path = m[1];
    if (path && m[2] === undefined && !path.endsWith("_line")) out.add(path);
  }
  return [...out];
}

/** Every required variable of `text` has a value in `ctx`. */
export function templateResolves(text: string, ctx: TemplateContext): boolean {
  const required = requiredVariables(text);
  if (required.length === 0) return true;
  const { missing } = renderWithReport(text, ctx);
  return !required.some((p) => missing.includes(p));
}

/**
 * What a composer message is about: the customer, plus the job or lead it was opened
 * from. A job's open estimate (sent/viewed) rides along so estimate templates render.
 * Callers have already checked the job/lead belongs to the viewer and the customer.
 */
export async function composerRef(
  exec: Tx,
  i: { customerId: string; jobId?: string | null; leadId?: string | null },
): Promise<ContextRef> {
  const jobId = i.jobId ?? null;
  const leadId = i.leadId ?? null;
  let entity: ContextRef["entity"] = jobId
    ? { type: "job", id: jobId }
    : leadId
      ? { type: "lead", id: leadId }
      : { type: "customer", id: i.customerId };
  if (jobId) {
    const [est] = await exec
      .select({ id: estimates.id })
      .from(estimates)
      .where(
        and(
          eq(estimates.jobId, jobId),
          eq(estimates.customerId, i.customerId),
          inArray(estimates.status, ["sent", "viewed"]),
        ),
      )
      .orderBy(desc(estimates.createdAt))
      .limit(1);
    if (est) entity = { type: "estimate", id: est.id };
  }
  return { customerId: i.customerId, jobId, leadId, entity };
}

export interface RenderedTemplate {
  body: string;
  subject: string | null;
  /** Variables that resolved to nothing (editor warnings). */
  missing: string[];
  channel: string;
}

export async function renderTemplateFor(
  tx: Tx,
  i: {
    templateKey: string;
    channel: string;
    customerId?: string | null;
    jobId?: string | null;
    leadId?: string | null;
    entity?: EntityRef | null;
    userId?: string | null;
    /** Mint real magic links (composer) vs preview placeholders (editor). */
    mint: boolean;
    vars?: Record<string, string>;
    /** Override the stored template text (editor live preview of unsaved edits). */
    bodyOverride?: string | null;
    subjectOverride?: string | null;
  },
): Promise<RenderedTemplate | null> {
  const tpl =
    i.bodyOverride !== undefined && i.bodyOverride !== null
      ? null
      : await findTemplate(tx, i.templateKey, i.channel);
  const body = i.bodyOverride ?? tpl?.body;
  if (body === undefined || body === null) return null;
  const subject = i.subjectOverride ?? tpl?.subject ?? null;
  const ref: ContextRef = {
    customerId: i.customerId ?? null,
    jobId: i.jobId ?? null,
    leadId: i.leadId ?? null,
    entity: i.entity ?? null,
    userId: i.userId ?? null,
  };
  const facts = await loadFacts(ref, tx);
  const tz = recipientTimeZone({
    propertyTz: facts.property?.timezone,
    zip: facts.property?.zip,
    companyTz: facts.tz,
  });
  const ctx = await buildTemplateContext(tx, facts, {
    variables: new Set([
      ...extractVariables(body),
      ...extractVariables(subject ?? ""),
    ]),
    mint: i.mint,
    timeZone: tz,
    vars: i.vars,
  });
  const b = renderWithReport(body, ctx);
  const s = subject ? renderWithReport(subject, ctx) : null;
  const isText =
    (tpl?.channel ?? i.channel) === "sms" || i.channel === "whatsapp";
  return {
    // An empty optional variable must not leave a double space in a text.
    body: isText ? collapseSpaces(b.text) : tidyEmailText(b.text),
    subject: s?.text.trim() ?? null,
    missing: [...new Set([...b.missing, ...(s?.missing ?? [])])],
    channel: tpl?.channel ?? i.channel,
  };
}
