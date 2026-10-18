// AI adapter interface (SPEC §9.4) — FROZEN.
import type { z } from "zod";

export type AiTaskKind =
  | "odometer"
  | "receipt"
  | "shop_invoice"
  | "tool_label"
  | "maintenance_suggest"
  | "explain_flags";

export interface AiProvider {
  id: "none" | "gemini";
  tier: "free" | "paid";
  extract<T>(i: {
    schema: z.ZodType<T>;
    jsonSchema: object;
    prompt: string;
    images: { mime: string; base64: string }[];
    kind: AiTaskKind;
  }): Promise<
    { data: T; model: string } | { error: string; retryable: boolean }
  >;
  text?(i: {
    prompt: string;
    kind: AiTaskKind;
  }): Promise<{ text: string } | { error: string; retryable: boolean }>;
}
