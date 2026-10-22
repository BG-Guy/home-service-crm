import { Chip, ChipRow } from "@/ui/components/Chip";
import { cx } from "@/ui/cx";

export interface TechChipItem {
  id: string;
  name: string;
  /** Route / calendar color (hex or a CSS var). */
  color: string;
  /** Jobs that day, shown after the name. */
  count?: number;
}

/**
 * A row of technician chips: a color dot, the first name and the day's job
 * count. Used by the schedule map (isolate one route, with "All") and the Assign
 * hub (pick the tech). `bare` is a plain row for a full-screen top bar; otherwise
 * the page's full-bleed ChipRow.
 */
export function TechChips({
  items,
  value,
  onChange,
  all,
  label,
  bare,
  className,
}: {
  items: readonly TechChipItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** A leading "All" chip (value `null`). */
  all?: boolean;
  /** The group's accessible name. */
  label: string;
  bare?: boolean;
  className?: string;
}) {
  const chips = (
    <>
      {all && (
        <Chip selected={!value} onClick={() => onChange(null)}>
          All
        </Chip>
      )}
      {items.map((t) => (
        <Chip
          key={t.id}
          selected={value === t.id}
          onClick={() => onChange(t.id)}
          count={t.count}
          icon={
            <span
              aria-hidden
              className="size-2 flex-none rounded-full"
              style={{ background: t.color }}
            />
          }
        >
          {t.name.split(" ")[0]}
        </Chip>
      ))}
    </>
  );
  return bare ? (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add chrome
    <div
      role="group"
      aria-label={label}
      className={cx("flex flex-none gap-1.5", className)}
    >
      {chips}
    </div>
  ) : (
    <ChipRow label={label} className={className}>
      {chips}
    </ChipRow>
  );
}
