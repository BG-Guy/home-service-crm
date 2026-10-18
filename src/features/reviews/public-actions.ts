"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { processEventsSoon } from "@/lib/events";
import { rateLimit } from "@/lib/ratelimit";
import { resolvePublicToken } from "@/lib/tokens";
import { recordReviewRating } from "./service";

// Public (no session) action for /r/[token]: the token is re-validated on every call
// and rate-limited per IP (SPEC M23: 60/min/IP for portal pages).

const Input = z.object({
  token: z.string().min(32).max(128),
  rating: z.coerce.number().int().min(1).max(5),
  feedback: z.string().trim().max(2000).optional(),
  wantsCallback: z.boolean().optional(),
});

export async function submitReviewRating(
  raw: z.input<typeof Input>,
): Promise<{ ok: true; rating: number } | { ok: false; error: string }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please pick 1 to 5 stars." };
  const h = await headers();
  // Trusted-proxy rule (QA T5-13): never the client-written leftmost hop.
  const ip = clientIpFromHeaders(h);
  const rl = await rateLimit({
    key: `portal:${ip ?? "unknown"}`,
    limit: 60,
    windowSec: 60,
  });
  if (!rl.ok)
    return { ok: false, error: "Too many tries. Please wait a minute." };
  const tok = await resolvePublicToken("review", parsed.data.token, {
    path: "/r",
    action: "rated",
    ip,
    userAgent: h.get("user-agent"),
  });
  if (!tok) return { ok: false, error: "This link has expired." };
  const res = await db.transaction((tx) =>
    recordReviewRating(tx, tok, {
      rating: parsed.data.rating,
      feedback: parsed.data.feedback ?? null,
      wantsCallback: parsed.data.wantsCallback,
    }),
  );
  await processEventsSoon();
  if (!res.ok || res.rating === null)
    return { ok: false, error: "This link isn't valid anymore." };
  return { ok: true, rating: res.rating };
}
