/**
 * Default body of a stubbed cross-module UI slot (BUILD_PLAN §2/§5). Renders
 * nothing in production and a dashed label in development, so unfinished
 * slots are visible while building but never ship.
 */
export function SlotPlaceholder({
  name,
  note,
}: {
  /** Slot name, e.g. "S2 PropertyCard". */
  name: string;
  note?: string;
}) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div
      data-slot-placeholder={name}
      className="rounded-tile border border-dashed border-label-3 px-3 py-2 text-footnote text-label-2"
    >
      <span className="font-semibold">{name}</span>
      {note ? ` — ${note}` : " — not built yet"}
    </div>
  );
}
