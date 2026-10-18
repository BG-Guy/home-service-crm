import "server-only";
import { getSecret } from "@/lib/secrets";
import type { AiProvider } from "./types";

// Gemini over REST (SPEC §9.4): generateContent with x-goog-api-key, JSON mode via
// responseMimeType + responseSchema, inline images. No temperature/top_p/top_k.

export function geminiModel(): string {
  return process.env.AI_MODEL_OCR || "gemini-3.5-flash-lite";
}

function tier(): "free" | "paid" {
  return process.env.AI_TIER === "paid" ? "paid" : "free";
}

async function generate(
  body: object,
): Promise<{ text: string } | { error: string; retryable: boolean }> {
  const key = await getSecret("GEMINI_API_KEY");
  if (!key) return { error: "GEMINI_API_KEY not set", retryable: false };
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      },
    );
  } catch (err) {
    return { error: String(err), retryable: true };
  }
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      error: json.error?.message ?? `Gemini HTTP ${res.status}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  }
  const text =
    json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  if (!text) return { error: "empty response", retryable: true };
  return { text };
}

export const geminiProvider: AiProvider = {
  id: "gemini",
  get tier() {
    return tier();
  },
  async extract({ schema, jsonSchema, prompt, images }) {
    const out = await generate({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((i) => ({
              inline_data: { mime_type: i.mime, data: i.base64 },
            })),
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: jsonSchema,
      },
    });
    if ("error" in out) return out;
    let parsed: unknown;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      return { error: "invalid JSON from model", retryable: false };
    }
    const res = schema.safeParse(parsed);
    if (!res.success)
      return {
        error: `schema mismatch: ${res.error.message.slice(0, 300)}`,
        retryable: false,
      };
    return { data: res.data, model: geminiModel() };
  },
  async text({ prompt }) {
    return generate({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
  },
};
