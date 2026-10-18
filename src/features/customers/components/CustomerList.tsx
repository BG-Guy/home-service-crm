import { Search, Users } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { customerTagOptions } from "../actions";
import type { CustomerFilter } from "../queries";
import { listCustomers } from "../queries";
import { globalSearch } from "../search";
import { CustomerLoadMore } from "./CustomerLoadMore";
import { CustomerRow } from "./CustomerRow";
import { CUSTOMER_TYPE_LABEL } from "./FlagChips";

function qs(f: CustomerFilter, patch: Partial<CustomerFilter>): string {
  const sp = new URLSearchParams();
  const next = { ...f, ...patch, cursor: patch.cursor };
  for (const [k, v] of Object.entries(next)) if (v) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "?";
}

/** Filter chips (Appendix A: `/customers?q=&type=&tag=&flag=`). */
export async function CustomerChips({
  filter,
  basePath = "/customers",
}: {
  filter: CustomerFilter;
  basePath?: string;
}) {
  const tags = await customerTagOptions().catch(() => []);
  const none = !filter.type && !filter.flag && !filter.tag;
  return (
    <ChipRow label="Filter customers">
      <Chip
        href={`${basePath}${qs(filter, { type: undefined, flag: undefined, tag: undefined })}`}
        selected={none}
        replace
      >
        All
      </Chip>
      {(
        [
          "residential",
          "commercial",
          "property_manager",
          "home_warranty",
        ] as const
      ).map((t) => (
        <Chip
          key={t}
          href={`${basePath}${qs(filter, { type: filter.type === t ? undefined : t })}`}
          selected={filter.type === t}
          replace
        >
          {CUSTOMER_TYPE_LABEL[t]}
        </Chip>
      ))}
      {[
        ["vip", "VIP"],
        ["prepay_required", "Prepay"],
        ["do_not_service", "Do not service"],
        ["dispute_history", "Disputes"],
        ["tax_exempt", "Tax exempt"],
      ].map(([k, label]) => (
        <Chip
          key={k}
          href={`${basePath}${qs(filter, { flag: filter.flag === k ? undefined : k })}`}
          selected={filter.flag === k}
          replace
        >
          {label}
        </Chip>
      ))}
      {tags.map((t) => (
        <Chip
          key={t.id}
          href={`${basePath}${qs(filter, { tag: filter.tag === t.id ? undefined : t.id })}`}
          selected={filter.tag === t.id}
          replace
        >
          {t.name}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** The customer rows + "other matches" from global search + keyset "Load more". */
export async function CustomerList({
  filter,
  viewer,
  activeId,
  basePath = "/customers",
  compact,
}: {
  filter: CustomerFilter;
  viewer: SessionUser;
  activeId?: string;
  basePath?: string;
  compact?: boolean;
}) {
  const [{ items, nextCursor }, other] = await Promise.all([
    listCustomers(filter),
    filter.q && !filter.cursor
      ? globalSearch(filter.q, viewer, 8).then((h) =>
          h.filter((x) => x.type !== "customer"),
        )
      : Promise.resolve([]),
  ]);
  const filtered = !!(filter.q || filter.type || filter.flag || filter.tag);

  if (items.length === 0 && other.length === 0) {
    return (
      <div className="list-card">
        {filtered ? (
          <EmptyState
            compact
            icon={<Search size={40} strokeWidth={1.6} />}
            title="No matches"
            message={
              filter.q
                ? `Nothing matches “${filter.q}”. Try a phone number, street or job #.`
                : "No customers match these filters."
            }
            action={
              <Button href={basePath} variant="gray" size="sm">
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users size={44} strokeWidth={1.6} />}
            title="No customers yet"
            message="Customers are added automatically from leads and jobs, or you can add one now."
            action={
              viewer.perms.has("customers.create") ? (
                <Button href="/customers/new" transition="push">
                  Add customer
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {items.length > 0 && (
        <ListSection header={filter.q ? "Customers" : undefined}>
          {items.map((c) => (
            <CustomerRow
              key={c.id}
              c={c}
              q={filter.q}
              active={activeId === c.id}
              compact={compact}
            />
          ))}
        </ListSection>
      )}
      {nextCursor && (
        <CustomerLoadMore
          filter={{
            q: filter.q,
            type: filter.type,
            tag: filter.tag,
            flag: filter.flag,
          }}
          cursor={nextCursor}
          activeId={activeId}
          compact={compact}
        />
      )}
      {other.length > 0 && (
        <ListSection header="Jobs, invoices & leads">
          {other.map((h) => (
            <ListRow
              key={`${h.type}:${h.id}`}
              title={h.title}
              subtitle={h.subtitle}
              detail={<span className="capitalize">{h.type}</span>}
              href={h.href}
            />
          ))}
        </ListSection>
      )}
    </div>
  );
}
