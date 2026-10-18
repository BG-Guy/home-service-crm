import { NextResponse } from "next/server";
import {
  afterIntake,
  BodyTooLarge,
  corsFor,
  corsHeaders,
  leadsOn,
  outcomeJson,
  readLeadBody,
  requestMetaOf,
} from "@/features/leads/intake/http";
import {
  apiKeyBySecret,
  type IntakeAuth,
  processLead,
  sourceByPublicKey,
  sourceBySecret,
  sourceForApiKey,
} from "@/features/leads/intake/process";

// JSON lead intake (SPEC §8.1, §8.3). Auth: `X-Site-Key: pk_…` (+ Origin allow-list)
// or `Authorization: Bearer sk_…` (a source secret or a general API key).

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const meta = requestMetaOf(req);
  const anyCors = corsHeaders(meta.origin);
  if (!(await leadsOn()))
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: anyCors },
    );
  let body: unknown;
  try {
    body = await readLeadBody(req);
  } catch (err) {
    if (err instanceof BodyTooLarge)
      return NextResponse.json(
        { error: "payload_too_large" },
        { status: 413, headers: anyCors },
      );
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: anyCors },
    );
  }

  let auth: IntakeAuth | null = null;
  const pk = req.headers.get("x-site-key")?.trim();
  const bearer = /^Bearer\s+(\S+)$/i.exec(
    req.headers.get("authorization") ?? "",
  )?.[1];
  if (bearer) {
    const src = await sourceBySecret(bearer);
    if (src) auth = { kind: "secret", source: src };
    else {
      const key = await apiKeyBySecret(bearer);
      if (key) {
        const hint =
          body && typeof body === "object"
            ? ((body as Record<string, unknown>).source ??
              (body as Record<string, unknown>).lead_source)
            : null;
        auth = {
          kind: "api_key",
          apiKeyId: key.id,
          source: await sourceForApiKey(typeof hint === "string" ? hint : null),
        };
      }
    }
  } else if (pk) {
    const src = await sourceByPublicKey(pk);
    if (src) auth = { kind: "public", source: src };
  }
  if (!auth)
    return NextResponse.json(
      {
        error: "unauthorized",
        message: "Send X-Site-Key: pk_… or Authorization: Bearer sk_…",
      },
      { status: 401, headers: anyCors },
    );

  const outcome = await processLead({
    auth,
    channel: "json",
    raw: body,
    ...meta,
  });
  await afterIntake(outcome);
  const headers =
    auth.kind === "public" ? corsFor(auth.source, meta.origin) : anyCors;
  return outcomeJson(outcome, headers, { publicKey: auth.kind === "public" });
}
