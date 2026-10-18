import "server-only";
import type { AiProvider } from "./types";

/** AI_PROVIDER=none: every flow still works by typing. */
export const noneProvider: AiProvider = {
  id: "none",
  tier: "free",
  async extract() {
    return { error: "AI is disabled (AI_PROVIDER=none)", retryable: false };
  },
  async text() {
    return { error: "AI is disabled (AI_PROVIDER=none)", retryable: false };
  },
};
