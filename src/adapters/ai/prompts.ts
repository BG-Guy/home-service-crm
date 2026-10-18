import { z } from "zod";
import type { AiTaskKind } from "./types";

// Default prompts + output schemas per AI task kind. Steward: B7 (refine freely;
// keep the output shapes stable for the aiHandlers that consume them).
export const PROMPT_VERSION = "v1";

const cents = z.number().int().nullable();

export const AI_OUTPUT_SCHEMAS = {
  odometer: z.object({
    reading: z.number().nullable(),
    unit: z.enum(["mi", "km"]).nullable(),
    confidence: z.number().min(0).max(1),
  }),
  receipt: z.object({
    vendor: z.string().nullable(),
    date: z.string().nullable(),
    subtotal_cents: cents,
    tax_cents: cents,
    total_cents: cents,
    gallons: z.number().nullable(),
    lines: z.array(
      z.object({
        name: z.string(),
        qty: z.number().nullable(),
        total_cents: cents,
      }),
    ),
    confidence: z.number().min(0).max(1),
  }),
  shop_invoice: z.object({
    vendor: z.string().nullable(),
    date: z.string().nullable(),
    odometer: z.number().nullable(),
    tasks: z.array(z.string()),
    total_cents: cents,
    confidence: z.number().min(0).max(1),
  }),
  tool_label: z.object({
    brand: z.string().nullable(),
    model: z.string().nullable(),
    serial: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  }),
  maintenance_suggest: z.object({ text: z.string() }),
  explain_flags: z.object({ text: z.string() }),
} satisfies Record<AiTaskKind, z.ZodType>;

export const AI_PROMPTS: Record<AiTaskKind, string> = {
  odometer:
    "Read the vehicle odometer in this photo. Return the total distance as a number (no trip meter), the unit, and your confidence 0-1. Use null if unreadable.",
  receipt:
    "Extract this purchase receipt. Amounts in integer US cents. Date as YYYY-MM-DD. Include gallons if it is a fuel receipt. Use null when a field is not visible.",
  shop_invoice:
    "Extract this vehicle service invoice: vendor, date (YYYY-MM-DD), odometer, the list of services performed (short lowercase task names such as oil_change, tire_rotation, brake_inspection), and the total in integer US cents.",
  tool_label:
    "Read the tool's nameplate/label: brand, model and serial number. Use null when not visible.",
  maintenance_suggest:
    "Suggest upcoming maintenance for this vehicle based only on the specs and mileage below. Short bullet list; say it is a suggestion for the admin to confirm.",
  explain_flags:
    "Explain these log anomaly flags in plain language for an admin reviewer. Two or three sentences.",
};

/** Minimal JSON Schema (OpenAPI subset accepted by Gemini responseSchema). */
export function jsonSchemaFor(kind: AiTaskKind): object {
  const n = { type: "number", nullable: true };
  const s = { type: "string", nullable: true };
  const conf = { type: "number" };
  switch (kind) {
    case "odometer":
      return {
        type: "object",
        properties: {
          reading: n,
          unit: { type: "string", enum: ["mi", "km"], nullable: true },
          confidence: conf,
        },
        required: ["reading", "confidence"],
      };
    case "receipt":
      return {
        type: "object",
        properties: {
          vendor: s,
          date: s,
          subtotal_cents: { type: "integer", nullable: true },
          tax_cents: { type: "integer", nullable: true },
          total_cents: { type: "integer", nullable: true },
          gallons: n,
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                qty: n,
                total_cents: { type: "integer", nullable: true },
              },
            },
          },
          confidence: conf,
        },
        required: ["total_cents", "lines", "confidence"],
      };
    case "shop_invoice":
      return {
        type: "object",
        properties: {
          vendor: s,
          date: s,
          odometer: n,
          tasks: { type: "array", items: { type: "string" } },
          total_cents: { type: "integer", nullable: true },
          confidence: conf,
        },
        required: ["tasks", "confidence"],
      };
    case "tool_label":
      return {
        type: "object",
        properties: { brand: s, model: s, serial: s, confidence: conf },
        required: ["confidence"],
      };
    default:
      return {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      };
  }
}
