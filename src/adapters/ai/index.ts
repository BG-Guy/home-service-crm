import "server-only";
import { geminiProvider } from "./gemini";
import { noneProvider } from "./none";
import type { AiProvider } from "./types";

// AI adapter (SPEC §9.4). AI_PROVIDER = none (default) | gemini. Never on the money path.

export { checkPolicy, findPii } from "./policy";
export {
  type AiRef,
  type AiStatus,
  type AiTaskRow,
  queueAiTask,
} from "./queue";
export type { AiProvider, AiTaskKind } from "./types";

export function aiProviderName(): "none" | "gemini" {
  return process.env.AI_PROVIDER === "gemini" ? "gemini" : "none";
}

export function getAi(): AiProvider {
  return aiProviderName() === "gemini" ? geminiProvider : noneProvider;
}
