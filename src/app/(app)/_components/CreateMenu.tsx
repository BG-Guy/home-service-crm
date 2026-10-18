"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AddMenu } from "@/ui/components/AddMenu";
import { type CreateItem, contextualize } from "./create-items";

/** A create entry with its icon already rendered on the server (HeaderActions). */
export type CreateMenuItem = CreateItem & { iconNode: ReactNode };

/**
 * The global "+" ActionSheet, reordered for the current page. Icons arrive
 * pre-rendered so the 60-icon `@/ui/icons` map never enters the client bundle.
 */
export function CreateMenu({ items }: { items: readonly CreateMenuItem[] }) {
  const pathname = usePathname() ?? "/";
  const ordered = contextualize(items, pathname);
  return (
    <AddMenu
      title="Create"
      label="Create new"
      items={ordered.map((i) => ({
        label: i.label,
        href: i.href,
        icon: i.iconNode,
      }))}
    />
  );
}
