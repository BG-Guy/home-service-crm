import { TONE_VAR, type Tone, toneFor } from "@/ui/tone";
import type { BoardTech } from "../../schedule-queries";

/** A technician's color: the stored hex or tone, else a stable tone from the id. */
export function techColor(t: BoardTech | undefined, id: string): string {
  const c = t?.color;
  if (c?.startsWith("#")) return c;
  if (c && c in TONE_VAR) return TONE_VAR[c as Tone];
  return TONE_VAR[toneFor(id)];
}
