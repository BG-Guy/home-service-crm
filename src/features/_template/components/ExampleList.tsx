import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { listExampleItems } from "../queries";
import { ExampleForm } from "./ExampleForm";

// Server Component by default (SPEC §14 rule 1): fetch through queries.ts, render
// UI-kit components, and keep client islands small (the form below).
export async function ExampleList({ canManage }: { canManage: boolean }) {
  const items = await listExampleItems();
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {canManage && <ExampleForm />}
      {items.length === 0 ? (
        <div className="list-card">
          <EmptyState
            compact
            icon={<ClipboardList size={44} />}
            title="Nothing here yet"
            message="Items you add show up in this list."
          />
        </div>
      ) : (
        <ListSection header="Open">
          {items.map((i) => (
            <ListRow
              key={i.id}
              title={i.title}
              detail={i.dueAt ? fmt.format(new Date(i.dueAt)) : undefined}
            />
          ))}
        </ListSection>
      )}
    </div>
  );
}
