import type { CSSProperties } from "react";

/**
 * Semantic color tones mapped to iOS system colors (SPEC §12.1).
 * Components accept a `tone` and expose it to CSS as `--tone`, so the
 * `.tint-bg`, `.tint-fg` and `.tone-fg` utilities in globals.css can derive
 * accessible tinted backgrounds and text in both light and dark mode.
 */
export type Tone =
  | "accent"
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "yellow"
  | "teal"
  | "indigo"
  | "purple"
  | "pink"
  | "brown"
  | "gray";

export const TONE_VAR: Record<Tone, string> = {
  accent: "var(--accent)",
  blue: "var(--sys-blue)",
  green: "var(--sys-green)",
  red: "var(--sys-red)",
  orange: "var(--sys-orange)",
  yellow: "var(--sys-yellow)",
  teal: "var(--sys-teal)",
  indigo: "var(--sys-indigo)",
  purple: "var(--sys-purple)",
  pink: "var(--sys-pink)",
  brown: "var(--sys-brown)",
  gray: "var(--sys-gray)",
};

/** Inline style that sets `--tone` (merge with your own style if needed). */
export function toneStyle(
  tone: Tone | undefined,
  extra?: CSSProperties,
): CSSProperties {
  return { ["--tone" as string]: TONE_VAR[tone ?? "accent"], ...extra };
}

/** Tones used for deterministic avatar / tag colors (no gray, no yellow: poor contrast with white text). */
export const AVATAR_TONES: readonly Tone[] = [
  "blue",
  "green",
  "orange",
  "teal",
  "indigo",
  "purple",
  "pink",
  "brown",
  "red",
];

/** Stable 32-bit FNV-1a hash of a string (for deterministic colors). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function toneFor(seed: string): Tone {
  return AVATAR_TONES[hashString(seed) % AVATAR_TONES.length] ?? "blue";
}
