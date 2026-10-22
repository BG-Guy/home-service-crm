import { cx } from "../cx";
import { TONE_VAR, type Tone, toneFor } from "../tone";

/** "Maria José Ortega" → "MO"; "acme" → "A". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last =
    parts.length > 1
      ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "")
      : "";
  return (first + last).toUpperCase();
}

export type AvatarStatus = "online" | "busy" | "away" | "offline";
const STATUS_TONE: Record<AvatarStatus, Tone> = {
  online: "green",
  busy: "red",
  away: "orange",
  offline: "gray",
};

/**
 * Photo or initials avatar (DESIGN.md §5): initials on a soft two-stop gradient
 * of the person's deterministic color.
 *
 * @param seed stable string for the color (user id); defaults to `name`.
 * @param size 24–64 px (default 40).
 * @param status small presence dot.
 * @param ring presence ring in a tone, drawn outside with a 2 px gap (clocked in, live).
 * @param presence shorthand for a green ring (clocked in / on shift).
 * @param color a CSS color for the initials gradient instead of the seed's tone
 *   (e.g. a tech's route color on the schedule map).
 */
export function Avatar({
  name,
  src,
  seed,
  size = 40,
  status,
  ring,
  presence,
  color,
  className,
}: {
  name: string;
  src?: string | null;
  seed?: string;
  size?: number;
  status?: AvatarStatus;
  ring?: Tone;
  presence?: boolean;
  color?: string;
  className?: string;
}) {
  const tone = toneFor(seed ?? name);
  const font = Math.round(size * 0.38);
  const dot = Math.max(8, Math.round(size * 0.26));
  const ringTone = ring ?? (presence ? "green" : undefined);
  const c = color ?? TONE_VAR[tone];
  return (
    <span
      className={cx("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        // biome-ignore lint/performance/noImgElement: pre-sized signed URLs; images.unoptimized (SPEC §14.7)
        <img
          src={src}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="size-full rounded-full bg-fill-2 object-cover"
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="flex size-full select-none items-center justify-center rounded-full font-semibold tracking-[0.01em] text-white"
          style={{
            fontSize: font,
            background: `linear-gradient(145deg, color-mix(in srgb, ${c} 70%, #fff), ${c} 55%, color-mix(in srgb, ${c} 82%, #000))`,
          }}
        >
          <span aria-hidden>{initials(name)}</span>
        </span>
      )}
      {ringTone && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full"
          style={{
            boxShadow: `inset 0 0 0 2px ${TONE_VAR[ringTone]}`,
          }}
        />
      )}
      {status && (
        <span
          role="img"
          aria-label={status}
          className="absolute bottom-0 right-0 rounded-full border-2 border-card"
          style={{
            width: dot,
            height: dot,
            background: TONE_VAR[STATUS_TONE[status]],
          }}
        />
      )}
    </span>
  );
}
