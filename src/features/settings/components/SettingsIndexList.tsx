"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { SearchField } from "@/ui/components/SearchField";
import type { SettingsNavItem } from "./SettingsNav";

/** /settings index list with an instant filter (labels and descriptions). */
export function SettingsIndexList({
  groups,
}: {
  groups: {
    key: string;
    label: string;
    items: (SettingsNavItem & { description?: string })[];
  }[];
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) =>
          `${i.label} ${i.description ?? ""} ${g.label}`
            .toLowerCase()
            .includes(n),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  return (
    <div className="flex flex-col gap-5">
      <SearchField
        onSearch={setQ}
        debounceMs={0}
        placeholder="Search settings"
        label="Search settings"
      />
      {filtered.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            title="No matching settings"
            message={`Nothing matches “${q.trim()}”.`}
          />
        </div>
      ) : (
        <ListGroup>
          {filtered.map((g) => (
            <ListSection key={g.key} header={g.label}>
              {g.items.map((i) => (
                <ListRow
                  key={i.key}
                  icon={i.icon}
                  iconTone={i.tone}
                  title={i.label}
                  subtitle={i.description}
                  href={i.href}
                />
              ))}
            </ListSection>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
