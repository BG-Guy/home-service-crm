"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { actionFailure } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { requestMeta } from "@/lib/auth/session";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import { processEventsSoon } from "@/lib/events";
import { rateLimit } from "@/lib/ratelimit";
import { type PortalAction, resolvePublicToken } from "@/lib/tokens";
import type { ActionResult, Actor } from "@/lib/types";
import { confirmJob, requestReschedule } from "./api";
import { jobRef } from "./internal";

// Public (no session) actions behind S8 PortalJobActions on /j/[token]. action()
// needs a signed-in user, so these mirror its steps by hand: zod → rate limit →
// token re-validation (hash, kind, expiry, revocation; logged in portal_access_log)
// → one transaction (write + events + audit + activity) → refresh().

const Base = z.object({
  token: z.string().min(32).max(128),
  jobId: z.string().uuid(),
});

async function withToken<T>(
  raw: unknown,
  schema: z.ZodType<T & { token: string; jobId: string }>,
  portalAction: PortalAction,
  run: (
    input: T & { token: string; jobId: string },
    actor: Actor,
  ) => Promise<void>,
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return { ok: false, error: "Something's missing — please try again." };
    const input = parsed.data;
    const meta = await requestMeta();
    const rl = await rateLimit({
      key: `portal:${meta.ip ?? "unknown"}`,
      limit: 60,
      windowSec: 60,
      store: "memory",
    });
    if (!rl.ok) throw new RateLimitedError(rl.retryAfterSec);
    const tok = await resolvePublicToken("job", input.token, {
      path: "/j/[token]",
      action: portalAction,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (!tok || (tok.jobId ?? tok.entityId) !== input.jobId)
      throw new NotFoundError("Link");
    const actor: Actor = {
      kind: "public_token",
      userId: null,
      tokenId: tok.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    await run(input, actor);
    try {
      refresh();
    } catch {
      // outside a Server Action request
    }
    await processEventsSoon();
    return { ok: true, data: { jobId: input.jobId } };
  } catch (e) {
    return actionFailure(e);
  }
}

/** S8: the customer confirms the appointment from the magic-link page. */
export async function portalConfirmJob(input: {
  token: string;
  jobId: string;
}): Promise<ActionResult<{ jobId: string }>> {
  return withToken(input, Base, "confirmed", async (i, actor) => {
    await db.transaction(async (tx) => {
      await confirmJob(tx, i.jobId, "portal", actor);
      await writeAudit(tx, {
        actor,
        action: "job.confirmed",
        entity: jobRef(i.jobId),
        after: { via: "portal" },
      });
    });
  });
}

/** S8: the customer asks to reschedule (optional note). */
export async function portalRequestReschedule(input: {
  token: string;
  jobId: string;
  note?: string | null;
}): Promise<ActionResult<{ jobId: string }>> {
  return withToken(
    input,
    Base.extend({ note: z.string().trim().max(1000).nullable().optional() }),
    "reschedule_requested",
    async (i, actor) => {
      await db.transaction(async (tx) => {
        await requestReschedule(
          tx,
          i.jobId,
          "portal",
          i.note?.trim() || null,
          actor,
        );
        await writeAudit(tx, {
          actor,
          action: "job.reschedule_requested",
          entity: jobRef(i.jobId),
          after: { via: "portal", note: i.note ?? null },
        });
      });
    },
  );
}
