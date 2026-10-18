import { TagChip } from "@/ui/components/Chip";
import { Pill } from "@/ui/components/StatusPill";
import { TONE_VAR, type Tone } from "@/ui/tone";
import type { CustomerFlags } from "../contracts";

// Presentational chips for customer flags and tags (server- and client-safe).

const FLAG_DEFS: {
  key: keyof CustomerFlags;
  label: string;
  tone: Tone;
}[] = [
  { key: "doNotService", label: "Do not service", tone: "red" },
  { key: "disputeHistory", label: "Dispute history", tone: "red" },
  { key: "prepayRequired", label: "Prepay required", tone: "orange" },
  { key: "vip", label: "VIP", tone: "purple" },
  { key: "taxExempt", label: "Tax exempt", tone: "teal" },
  { key: "doNotText", label: "Do not text", tone: "gray" },
  { key: "doNotContact", label: "Do not contact", tone: "gray" },
];

export const FLAG_LABELS = Object.fromEntries(
  FLAG_DEFS.map((f) => [f.key, f.label]),
) as Record<keyof CustomerFlags, string>;

export function FlagChips({
  flags,
  returning,
  size = "sm",
  max,
}: {
  flags: CustomerFlags;
  returning?: boolean;
  size?: "sm" | "md";
  max?: number;
}) {
  const on = FLAG_DEFS.filter((f) => flags[f.key]);
  const shown = max != null ? on.slice(0, max) : on;
  if (shown.length === 0 && !returning) return null;
  return (
    <>
      {returning && (
        <Pill tone="blue" size={size} dot={false}>
          Returning
        </Pill>
      )}
      {shown.map((f) => (
        <Pill key={f.key} tone={f.tone} size={size}>
          {f.label}
        </Pill>
      ))}
      {max != null && on.length > max && (
        <Pill tone="gray" size={size} dot={false}>
          +{on.length - max}
        </Pill>
      )}
    </>
  );
}

/** Tag colors are stored as a tone name ("red") or a CSS color ("#ff9500"). */
export function Tag({
  name,
  color,
  size = "sm",
}: {
  name: string;
  color: string | null | undefined;
  size?: "sm" | "md";
}) {
  const isTone = !!color && color in TONE_VAR;
  return (
    <TagChip
      name={name}
      size={size}
      tone={isTone ? (color as Tone) : "gray"}
      color={isTone ? undefined : color}
    />
  );
}

export const CUSTOMER_TYPE_LABEL: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  property_manager: "Property manager",
  home_warranty: "Home warranty",
};
