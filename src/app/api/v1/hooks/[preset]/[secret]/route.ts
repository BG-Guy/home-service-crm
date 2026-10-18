import { NextResponse } from "next/server";
import {
  afterIntake,
  BodyTooLarge,
  leadsOn,
  outcomeJson,
  readLeadBody,
  requestMetaOf,
} from "@/features/leads/intake/http";
import {
  processLead,
  sourceByHookSecret,
} from "@/features/leads/intake/process";

// Preset hooks (SPEC §8.1): generic, zapier, make, thumbtack, angi, google_ads_leadform.
// The path secret is compared by hash. Google expects `200 {}`.

export const dynamic = "force-dynamic";

const PRESETS = new Set([
  "generic",
  "zapier",
  "make",
  "thumbtack",
  "angi",
  "google_ads_leadform",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ preset: string; secret: string }> },
) {
  const { preset, secret } = await params;
  if (!PRESETS.has(preset) || !(await leadsOn()))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const src = await sourceByHookSecret(secret);
  if (!src)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await readLeadBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge)
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const outcome = await processLead({
    auth: { kind: "hook", source: src, preset },
    channel: "hook",
    raw: body,
    ...requestMetaOf(req),
  });
  await afterIntake(outcome);
  if (preset === "google_ads_leadform") {
    if (outcome.status === "forbidden")
      return NextResponse.json({ error: "bad_google_key" }, { status: 401 });
    return NextResponse.json({}, { status: 200 });
  }
  return outcomeJson(outcome, {});
}
