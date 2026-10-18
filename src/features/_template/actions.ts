"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "@/db/schema";
import { action } from "@/lib/action";
import type { Perm } from "@/lib/permissions";

// Mutations (SPEC §8.2): every write is a server action built with action(), which
// does auth → feature flag → zod → clientId idempotency → ONE transaction
// (your write + emit() events + audit + activity) → revalidatePath + refresh()
// → after(processEvents). Never open your own transaction or call providers here;
// slow/provider work goes to an event handler or job_queue worker.
//
// Use from a form:   const [state, formAction] = useActionState(createExampleItem, null)
// or call directly:  await createExampleItem({ title: "…", clientId })

const MANAGE = "example.manage" as Perm; // drop the cast once registered

export const createExampleItem = action({
  perm: MANAGE,
  // feature: "example",       // uncomment once the module declares a flag
  input: z.object({
    title: z.string().trim().min(1, "Enter a title.").max(200),
    dueAt: z.coerce.date().optional(),
    // Offline-capable actions take a client id; replays return the stored result.
    clientId: z.string().uuid().optional(),
  }),
  audit: "example.created",
  async run({ input, tx, user, activity }) {
    const [row] = await tx
      .insert(tasks)
      .values({
        kind: "custom",
        title: input.title,
        dueAt: input.dueAt ?? null,
        assigneeUserId: user.id,
        createdBy: user.id,
      })
      .returning({ id: tasks.id });
    if (!row) throw new Error("insert failed");
    // Timeline row (shown by the S33 ActivityTimeline). Never put PII in `summary`.
    await activity({
      entity: { type: "task", id: row.id },
      kind: "task.created",
      summary: `Added "${input.title}"`,
    });
    // Domain events: `await emit("task.created", { type: "task", id: row.id }, {...})`
    // — the type must exist in EventMap (src/lib/event-types.ts).
    return { id: row.id };
  },
  // Declared after run() so TypeScript infers the result type from run.
  auditEntity: ({ data }) => ({ type: "task", id: data.id }),
  revalidate: () => ["/example"],
});

export const completeExampleItem = action({
  perm: MANAGE,
  input: z.object({ id: z.string().uuid() }),
  audit: "example.completed",
  async run({ input, tx, user }) {
    await tx
      .update(tasks)
      .set({
        status: "done",
        doneAt: new Date(),
        doneBy: user.id,
        updatedAt: new Date(), // updated_at is never automatic — set it yourself
      })
      .where(eq(tasks.id, input.id));
    return { id: input.id };
  },
  auditEntity: ({ input }) => ({ type: "task", id: input.id }),
  revalidate: () => ["/example"],
});
