import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { aiTasks, media } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { enqueueJob } from "@/lib/queue";
import { getStorage } from "../storage";
import { checkPolicy, consumeBudget } from "./policy";
import {
  AI_OUTPUT_SCHEMAS,
  AI_PROMPTS,
  jsonSchemaFor,
  PROMPT_VERSION,
} from "./prompts";
import type { AiTaskKind } from "./types";

// AI queue (SPEC §9.4; BUILD_PLAN §2, §8.2-8.3; owned by F). queueAiTask() caches by
// input hash and enqueues a `job_queue` kind `ai`; the worker applies the policy layer
// (tier, PII, budget), calls the provider, stores the output and routes the result to
// the owning module's aiHandlers by `ref.module`.

export type AiTaskRow = typeof aiTasks.$inferSelect;
export type AiStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped_budget"
  | "skipped_policy";
export interface AiRef {
  module: string; // 'parts' | 'vehicles' | 'tools'
  entityType: string;
  entityId: string;
}

export interface AiJobPayload {
  aiTaskId: string;
  ref: AiRef;
  /** Extra context for text kinds (vehicle specs/mileage only — never PII). */
  context?: string | null;
  isDocument?: boolean;
}

const TEXT_KINDS: readonly AiTaskKind[] = [
  "maintenance_suggest",
  "explain_flags",
];

export function aiInputHash(
  kind: AiTaskKind,
  mediaIds: string[],
  context?: string | null,
): string {
  return sha256Hex(
    `${PROMPT_VERSION}|${kind}|${[...mediaIds].sort().join(",")}|${context ?? ""}`,
  );
}

/** Queue (or reuse a cached) AI extraction. Never blocks the caller's workflow. */
export async function queueAiTask(
  tx: Tx,
  i: {
    kind: AiTaskKind;
    mediaIds: string[];
    ref: AiRef;
    context?: string | null;
    isDocument?: boolean;
  },
): Promise<{ aiTaskId: string; status: AiStatus }> {
  const inputHash = aiInputHash(i.kind, i.mediaIds, i.context);
  const inserted = await tx
    .insert(aiTasks)
    .values({ kind: i.kind, inputHash, mediaIds: i.mediaIds, status: "queued" })
    .onConflictDoNothing({ target: [aiTasks.kind, aiTasks.inputHash] })
    .returning({ id: aiTasks.id, status: aiTasks.status });
  let row = inserted[0];
  if (!row) {
    const [existing] = await tx
      .select({ id: aiTasks.id, status: aiTasks.status })
      .from(aiTasks)
      .where(and(eq(aiTasks.kind, i.kind), eq(aiTasks.inputHash, inputHash)))
      .limit(1);
    row = existing;
    if (
      row &&
      ["failed", "skipped_budget", "skipped_policy"].includes(row.status)
    ) {
      await tx
        .update(aiTasks)
        .set({ status: "queued", error: null })
        .where(eq(aiTasks.id, row.id));
      row = { ...row, status: "queued" };
    }
  }
  if (!row) throw new Error("ai_tasks insert failed");
  const payload: AiJobPayload = {
    aiTaskId: row.id,
    ref: i.ref,
    context: i.context ?? null,
    isDocument: i.isDocument,
  };
  await enqueueJob(tx, "ai", payload as unknown as Record<string, unknown>, {
    dedupeKey: `ai:${row.id}:${i.ref.module}:${i.ref.entityId}`,
  });
  return { aiTaskId: row.id, status: row.status as AiStatus };
}

async function deliver(
  task: AiTaskRow,
  ref: AiRef,
  output: unknown,
): Promise<void> {
  const { getAiHandler } = await import("./handlers");
  const handler = getAiHandler(ref.module, task.kind as AiTaskKind);
  if (handler) await handler(task, output);
}

class RetryableAiError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** job_queue worker for kind `ai`. */
export async function runAiJob(
  payload: AiJobPayload,
  ctx: { attempt: number },
): Promise<void> {
  const [task] = await db
    .select()
    .from(aiTasks)
    .where(eq(aiTasks.id, payload.aiTaskId))
    .limit(1);
  if (!task) return;
  if (task.status === "done") return deliver(task, payload.ref, task.output);

  const kind = task.kind as AiTaskKind;
  const finish = async (patch: Partial<AiTaskRow>, output: unknown) => {
    const [row] = await db
      .update(aiTasks)
      .set({ ...patch, attempts: task.attempts + 1, completedAt: new Date() })
      .where(eq(aiTasks.id, task.id))
      .returning();
    await deliver(row ?? task, payload.ref, output);
  };

  const { getAi } = await import("./index");
  const provider = getAi();
  if (provider.id === "none")
    return finish(
      { status: "skipped_policy", error: "AI_PROVIDER=none" },
      null,
    );

  const policy = checkPolicy({
    kind,
    tier: provider.tier,
    isDocument: payload.isDocument,
    prompt: payload.context,
  });
  if (!policy.ok)
    return finish({ status: policy.status, error: policy.reason }, null);
  if (!(await consumeBudget()))
    return finish(
      { status: "skipped_budget", error: "daily AI budget reached" },
      null,
    );

  await db
    .update(aiTasks)
    .set({ status: "running" })
    .where(eq(aiTasks.id, task.id));
  const prompt = payload.context
    ? `${AI_PROMPTS[kind]}\n\n${payload.context}`
    : AI_PROMPTS[kind];

  let result:
    | { data: unknown; model?: string }
    | { error: string; retryable: boolean };
  if (TEXT_KINDS.includes(kind)) {
    const out = provider.text
      ? await provider.text({ prompt, kind })
      : { error: "text not supported", retryable: false };
    result = "error" in out ? out : { data: { text: out.text } };
  } else {
    const rows = task.mediaIds.length
      ? await db
          .select({ id: media.id, key: media.storageKey, mime: media.mime })
          .from(media)
          .where(inArray(media.id, task.mediaIds))
      : [];
    const storage = getStorage();
    const images = await Promise.all(
      rows.slice(0, 4).map(async (m) => ({
        mime: m.mime,
        base64: Buffer.from(await storage.get(m.key)).toString("base64"),
      })),
    );
    result = await provider.extract({
      schema: AI_OUTPUT_SCHEMAS[kind] as never,
      jsonSchema: jsonSchemaFor(kind),
      prompt,
      images,
      kind,
    });
  }

  if ("error" in result) {
    if (result.retryable && ctx.attempt < 5) {
      await db
        .update(aiTasks)
        .set({
          status: "queued",
          error: result.error,
          attempts: task.attempts + 1,
        })
        .where(eq(aiTasks.id, task.id));
      const backoff =
        Math.min(3600_000, 60_000 * 2 ** ctx.attempt) *
        (0.75 + Math.random() * 0.5);
      throw new RetryableAiError(result.error, Math.round(backoff));
    }
    return finish({ status: "failed", error: result.error }, null);
  }
  return finish(
    {
      status: "done",
      output: result.data as never,
      model: "model" in result ? (result.model ?? null) : null,
      error: null,
    },
    result.data,
  );
}
