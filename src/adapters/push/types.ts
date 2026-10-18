// Push adapter interface (SPEC §9.6) — FROZEN.
import type { pushSubscriptions } from "@/db/schema";

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  badge?: number;
}
export interface PushProvider {
  send(
    sub: PushSubscriptionRow,
    payload: PushPayload,
  ): Promise<"ok" | "gone" | "retry">;
}
