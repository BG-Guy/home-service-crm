// Permission keys + default grants for module `media` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B4. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "photos.upload": "AOT", // Upload photos to jobs
  "photos.delete": "A", // Soft-delete photos (audited)
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type MediaPerm = keyof typeof grants;
export const perms = Object.keys(grants) as MediaPerm[];

export const flags = [
  { key: "photos", default: true },
  { key: "before_after", default: true },
] as const;
