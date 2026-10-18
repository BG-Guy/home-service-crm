import { Avatar } from "@/ui/components/Avatar";
import { ListRow } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import type { CustomerFlags, CustomerListItem } from "../contracts";
import { CUSTOMER_TYPE_LABEL, FLAG_LABELS, FlagChips, Tag } from "./FlagChips";

const NO_FLAGS: CustomerFlags = {
  doNotService: false,
  prepayRequired: false,
  disputeHistory: false,
  vip: false,
  taxExempt: false,
  doNotText: false,
  doNotContact: false,
};

/**
 * One customer list row (server- and client-safe presentational component). At most
 * one pill plus "+N" sits next to the name so names don't truncate; the other labels
 * go on the subtitle, and a tag that repeats a flag ("VIP") isn't shown twice (T4-27).
 */
export function CustomerRow({
  c,
  q,
  active,
  compact,
}: {
  c: CustomerListItem;
  q?: string;
  active?: boolean;
  compact?: boolean;
}) {
  const flagKeys = (Object.keys(FLAG_LABELS) as (keyof CustomerFlags)[]).filter(
    (k) => c.flags[k],
  );
  const flagNames = new Set(flagKeys.map((k) => FLAG_LABELS[k].toLowerCase()));
  const tags = c.tags.filter(
    (t) => !flagNames.has(t.name.trim().toLowerCase()),
  );
  const firstFlag = flagKeys[0];
  const firstTag = firstFlag ? undefined : tags[0];
  const rest = [
    ...flagKeys.slice(firstFlag ? 1 : 0).map((k) => FLAG_LABELS[k]),
    ...tags.slice(firstTag ? 1 : 0).map((t) => t.name),
  ];
  const contact =
    [c.phoneDisplay, c.addressShort].filter(Boolean).join(" · ") ||
    CUSTOMER_TYPE_LABEL[c.type];
  return (
    <ListRow
      leading={
        <Avatar name={c.displayName} seed={c.id} size={compact ? 34 : 40} />
      }
      href={`/customers/${c.id}${q ? `?q=${encodeURIComponent(q)}` : ""}`}
      current={active}
      className={active ? "bg-fill-2" : undefined}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate">{c.displayName}</span>
          {!compact && (firstFlag || firstTag) && (
            <span className="flex shrink-0 items-center gap-1">
              {firstFlag ? (
                <FlagChips flags={{ ...NO_FLAGS, [firstFlag]: true }} />
              ) : firstTag ? (
                <Tag name={firstTag.name} color={firstTag.color} />
              ) : null}
              {rest.length > 0 && (
                <Pill tone="gray" size="sm" dot={false}>
                  +{rest.length}
                </Pill>
              )}
            </span>
          )}
        </span>
      }
      subtitle={
        !compact && rest.length > 0
          ? `${contact} · ${rest.join(", ")}`
          : contact
      }
    />
  );
}
