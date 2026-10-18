import "server-only";
import { aiHandlers as parts } from "@/features/parts/ai";
import { aiHandlers as tools } from "@/features/tools/ai";
import { aiHandlers as vehicles } from "@/features/vehicles/ai";
import type { AiTaskRow } from "./queue";
import type { AiTaskKind } from "./types";

// Aggregator of module AI result handlers (BUILD_PLAN §4 ai.ts, §8.3), routed by
// ai job `ref.module`.

export type AiHandler = (task: AiTaskRow, output: unknown) => Promise<void>;

const byModule: Record<string, Partial<Record<AiTaskKind, AiHandler>>> = {
  parts,
  vehicles,
  tools,
};

export function getAiHandler(
  module: string,
  kind: AiTaskKind,
): AiHandler | undefined {
  return byModule[module]?.[kind];
}
