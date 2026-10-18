import { Download } from "lucide-react";
import { Suspense } from "react";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import type { SessionUser } from "@/lib/types";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { SkeletonList } from "@/ui/components/Skeleton";
import type { CustomerFilter } from "../queries";
import { CustomerChips, CustomerList } from "./CustomerList";

/** The searchable customer list column (full page on phones, left pane on desktop). */
export function CustomersPane({
  filter,
  viewer,
  activeId,
}: {
  filter: CustomerFilter;
  viewer: SessionUser;
  activeId?: string;
}) {
  return (
    <>
      <LargeTitleHeader
        title="Customers"
        trailing={
          <>
            {viewer.perms.has("customers.export") && (
              <a
                href="/customers/export"
                aria-label="Export customers (CSV)"
                title="Export CSV"
                className="pressable flex size-11 items-center justify-center rounded-full text-accent-text hover:bg-fill-2"
              >
                <Download size={21} aria-hidden />
              </a>
            )}
            <HeaderActions />
          </>
        }
        search={
          <SearchField
            param="q"
            defaultValue={filter.q ?? ""}
            placeholder="Name, phone, street, job #"
            label="Search customers"
          />
        }
      >
        <Suspense fallback={<div className="h-8" />}>
          <CustomerChips filter={filter} />
        </Suspense>
      </LargeTitleHeader>
      <div className="mx-auto w-full max-w-[var(--content-max)] px-[var(--gutter)] pb-8">
        <Suspense
          key={JSON.stringify(filter)}
          fallback={<SkeletonList rows={10} leading="avatar" />}
        >
          <CustomerList
            filter={filter}
            viewer={viewer}
            activeId={activeId}
            compact={!!activeId}
          />
        </Suspense>
      </div>
    </>
  );
}

export function filterFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
): CustomerFilter {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s?.trim() ? s.trim().slice(0, 100) : undefined;
  };
  return { q: one("q"), type: one("type"), tag: one("tag"), flag: one("flag") };
}
