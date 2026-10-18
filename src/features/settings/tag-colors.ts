// Tag colors (SPEC M21 Tags). Client-safe. Tags store a system tone key ("blue",
// "red"…) in `tags.color` so they follow light/dark mode; legacy hex values still work.
// `tagColorCss()` turns the stored value into a CSS color that the UI-kit `TagChip`
// accepts directly (`<TagChip name={t.name} color={t.color} />`).
import { TONE_VAR, type Tone } from "@/ui/tone";

export const TAG_COLORS = [
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "pink",
  "teal",
  "indigo",
  "yellow",
  "brown",
  "gray",
] as const satisfies readonly Tone[];
export type TagColor = (typeof TAG_COLORS)[number];

const HEX = /^#[0-9a-f]{6}$/i;

export function isTagColor(v: string): v is TagColor {
  return (TAG_COLORS as readonly string[]).includes(v);
}

/** Stored tag color → CSS color (`var(--sys-blue)` or a hex). Unknown → gray. */
export function tagColorCss(color: string | null | undefined): string {
  if (!color) return TONE_VAR.gray;
  if (isTagColor(color)) return TONE_VAR[color];
  if (HEX.test(color)) return color;
  return TONE_VAR.gray;
}

/** Normalize user input to a storable tag color. */
export function normalizeTagColor(input: string | null | undefined): string {
  const v = (input ?? "").trim().toLowerCase();
  if (isTagColor(v)) return v;
  if (HEX.test(v)) return v;
  return "gray";
}
