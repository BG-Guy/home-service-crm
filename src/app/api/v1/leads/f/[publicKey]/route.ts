import { NextResponse } from "next/server";
import {
  afterIntake,
  BodyTooLarge,
  corsFor,
  leadsOn,
  outcomeJson,
  readLeadBody,
  requestMetaOf,
  safeLeadRedirect,
} from "@/features/leads/intake/http";
import {
  processLead,
  smsConsentShown,
  sourceByPublicKey,
} from "@/features/leads/intake/process";
import { signTs } from "@/features/leads/intake/spam";
import { tsSecret, turnstileSiteKey } from "@/features/leads/keys";
import { appUrl } from "@/lib/env";
import { getSettings } from "@/lib/settings";

// Form-encoded lead intake (SPEC §8.1): plain HTML forms POST here and get a 303 to the
// allow-listed `redirect` or the hosted thank-you page. embed.js posts with fetch and
// `X-Requested-With: crm-embed` and gets JSON. GET returns the embed config (signed
// `_ts`, Turnstile site key, consent wording).

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ publicKey: string }> };

function wantsJson(req: Request): boolean {
  if (req.headers.get("x-requested-with") === "crm-embed") return true;
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function thanksUrl(pk: string, status?: string): string {
  return appUrl(`/f/${pk}/thanks${status ? `?status=${status}` : ""}`);
}

export async function OPTIONS(req: Request, { params }: Ctx) {
  const { publicKey } = await params;
  const src = await sourceByPublicKey(publicKey);
  return new Response(null, {
    status: 204,
    headers: corsFor(src, req.headers.get("origin")),
  });
}

export async function GET(req: Request, { params }: Ctx) {
  const { publicKey } = await params;
  const src = (await leadsOn()) ? await sourceByPublicKey(publicKey) : null;
  const origin = req.headers.get("origin");
  if (!src)
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: corsFor(null, origin) },
    );
  const s = await getSettings();
  return NextResponse.json(
    {
      ts: signTs(tsSecret(), publicKey),
      turnstile: src.turnstileRequired ? turnstileSiteKey() : null,
      // embed.js shows this next to the box and posts it back as consent_text.
      consent: await smsConsentShown(s),
      marketing: s.compliance.marketing_consent_text,
    },
    { headers: { ...corsFor(src, origin), "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request, { params }: Ctx) {
  const { publicKey } = await params;
  const meta = requestMetaOf(req);
  const json = wantsJson(req);
  if (!(await leadsOn()))
    return json
      ? NextResponse.json({ error: "not_found" }, { status: 404 })
      : new NextResponse("Not found", { status: 404 });
  const src = await sourceByPublicKey(publicKey);
  if (!src)
    return json
      ? NextResponse.json(
          { error: "unknown_key" },
          { status: 404, headers: corsFor(null, meta.origin) },
        )
      : new NextResponse(
          "This form isn't connected: the site key is unknown or disabled.",
          {
            status: 404,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
  const headers = corsFor(src, meta.origin);
  let body: unknown;
  try {
    body = await readLeadBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge)
      return json
        ? NextResponse.json(
            { error: "payload_too_large" },
            { status: 413, headers },
          )
        : new NextResponse("Request too large", { status: 413 });
    body = {};
  }
  const outcome = await processLead({
    auth: { kind: "public", source: src },
    channel: "form",
    raw: body,
    ...meta,
  });
  await afterIntake(outcome);
  if (json) return outcomeJson(outcome, headers, { publicKey: true });

  // Browser form post: always land somewhere friendly (303 → GET).
  if (outcome.status === "rate_limited")
    return NextResponse.redirect(thanksUrl(publicKey, "busy"), 303);
  const raw = (body ?? {}) as Record<string, unknown>;
  const redirect = ["redirect", "_redirect", "redirect_url", "_next"]
    .map((k) => raw[k])
    .find((v): v is string => typeof v === "string" && v.length > 0);
  const target = safeLeadRedirect(redirect, src) ?? thanksUrl(publicKey);
  return NextResponse.redirect(target, 303);
}
