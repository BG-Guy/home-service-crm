import "server-only";
import { NextResponse } from "next/server";
import { processEventsSoon } from "@/lib/events";
import { clientIp } from "@/lib/http";
import { isEnabled } from "@/lib/settings";
import type { IntakeOutcome, LeadSourceRow } from "./process";
import { originAllowed } from "./process";

// HTTP plumbing shared by the public intake endpoints (SPEC §8.1, §8.3 step 1).

export const MAX_BODY_BYTES = 32 * 1024;

export class BodyTooLarge extends Error {}

/**
 * Read the raw body, aborting as soon as it passes `max` bytes. Content-Length can be
 * absent (chunked) or wrong, so the cap is enforced on the stream itself (T5-18).
 */
async function readCapped(
  req: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Parse JSON, urlencoded or multipart bodies (≤ 32 KB) into a plain object. */
export async function readLeadBody(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) throw new BodyTooLarge();
  const contentType = req.headers.get("content-type") ?? "";
  const type = contentType.toLowerCase();
  const bytes = await readCapped(req, MAX_BODY_BYTES);
  if (type.includes("multipart/form-data")) {
    const fd = await new Response(bytes, {
      headers: { "content-type": contentType },
    }).formData();
    return formToObject(fd);
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return {};
  if (type.includes("application/x-www-form-urlencoded"))
    return formToObject(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    // Some form builders post urlencoded without a content type.
    if (/^[\w%.[\]-]+=/.test(text))
      return formToObject(new URLSearchParams(text));
    return { _unparsed: text.slice(0, 2000) };
  }
}

function formToObject(fd: FormData | URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue; // never accept files on lead forms
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const key = k.endsWith("[]") ? k.slice(0, -2) : k;
    const prev = out[key];
    // Checkbox groups and duplicate names: keep the first non-empty value.
    if (prev === undefined || prev === "") out[key] = v;
  }
  return out;
}

/** CORS headers for browser callers (pk keys). Never sends credentials. */
export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Site-Key, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && origin !== "null") h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** Echo the Origin only when the source allows it (empty list = any). */
export function corsFor(
  source: Pick<LeadSourceRow, "allowedOrigins"> | null,
  origin: string | null,
): Record<string, string> {
  if (!origin) return corsHeaders(null);
  if (!source) return corsHeaders(origin);
  return originAllowed(source.allowedOrigins ?? [], origin, null)
    ? corsHeaders(origin)
    : corsHeaders(null);
}

export function requestMetaOf(req: Request) {
  return {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
  };
}

export async function leadsOn(): Promise<boolean> {
  try {
    return await isEnabled("leads");
  } catch {
    return false;
  }
}

/**
 * JSON response for an intake outcome (SPEC §8.1 status codes). Browser callers with
 * a public site key get one uniform `200 {status:"received"}` for created, merged and
 * spam alike, so the response never reveals whether someone is already a customer
 * (T5-18). Secret-key / API-key callers keep the detailed 201/200 with ids.
 */
export function outcomeJson(
  o: IntakeOutcome,
  headers: Record<string, string>,
  opts?: { publicKey?: boolean },
): NextResponse {
  if (
    opts?.publicKey &&
    (o.status === "created" || o.status === "merged" || o.status === "spam")
  )
    return NextResponse.json({ status: "received" }, { status: 200, headers });
  switch (o.status) {
    case "created":
      return NextResponse.json(
        { id: o.leadId, status: "created", customer_id: o.customerId },
        { status: 201, headers },
      );
    case "merged":
      return NextResponse.json(
        { id: o.leadId, status: "merged", customer_id: o.customerId },
        { status: 200, headers },
      );
    case "spam":
      // Fake success: never tell a bot it was caught.
      return NextResponse.json(
        { status: "received" },
        { status: 200, headers },
      );
    case "invalid":
      return NextResponse.json(
        { error: "invalid_request", errors: o.errors },
        { status: 400, headers },
      );
    case "rate_limited":
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(o.retryAfterSec) },
        },
      );
    case "forbidden":
      return NextResponse.json(
        { error: "forbidden", reason: o.reason },
        { status: 403, headers },
      );
  }
}

/** Kick the event processor after the response (automations: ack text, alerts). */
export async function afterIntake(o: IntakeOutcome): Promise<void> {
  if (o.status === "created" || o.status === "merged")
    await processEventsSoon();
}

/** Allowed post-submit redirect (absolute URL whose origin is allow-listed), else null. */
export function safeLeadRedirect(
  redirect: string | null | undefined,
  source: Pick<LeadSourceRow, "allowedOrigins">,
): string | null {
  if (!redirect) return null;
  let u: URL;
  try {
    u = new URL(redirect);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const allowed = source.allowedOrigins ?? [];
  // With no allow-list we can't tell a real site from an open redirect: refuse.
  if (allowed.length === 0) return null;
  return originAllowed(allowed, u.origin, null) ? u.toString() : null;
}
