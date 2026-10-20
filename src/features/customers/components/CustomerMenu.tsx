"use client";

import { Ellipsis } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import type { CustomerEditable } from "../contracts";

// The edit form, the "…" action sheet and the anonymize confirm live in their own
// chunk, fetched on hover/focus or the first tap (DESIGN.md §2).
const load = () => import("./CustomerMenuSheets");
const CustomerMenuSheets = dynamic(load, { ssr: false });

/** Detail nav-bar actions: Edit (sheet) and the "…" menu (merge, archive, anonymize). */
export function CustomerMenu({
  customer,
  customDefs,
  canEdit,
  canMerge,
  canDelete,
  archived,
  anonymized,
}: {
  customer: CustomerEditable | null;
  customDefs: CustomFieldDef[];
  canEdit: boolean;
  canMerge: boolean;
  canDelete: boolean;
  archived: boolean;
  anonymized: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [edit, setEditState] = useState(false);
  const [menu, setMenuState] = useState(false);
  const id = customer?.id;
  const hasMenu = (canMerge && !!id && !anonymized) || (canDelete && !!id);
  const prefetch = () => void load();
  const setEdit = (v: boolean) => {
    if (v) setArmed(true);
    setEditState(v);
  };
  const setMenu = (v: boolean) => {
    if (v) setArmed(true);
    setMenuState(v);
  };

  return (
    <>
      {canEdit && customer && !anonymized && (
        <Button
          variant="plain"
          size="sm"
          onClick={() => setEdit(true)}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-haspopup="dialog"
        >
          Edit
        </Button>
      )}
      {hasMenu && (
        <IconButton
          label="More actions"
          onClick={() => setMenu(true)}
          onPointerEnter={prefetch}
          onFocus={prefetch}
          aria-haspopup="menu"
        >
          <Ellipsis size={22} />
        </IconButton>
      )}
      {armed && (
        <CustomerMenuSheets
          customer={customer}
          customDefs={customDefs}
          canMerge={canMerge}
          canDelete={canDelete}
          archived={archived}
          anonymized={anonymized}
          edit={edit}
          setEdit={setEdit}
          menu={menu}
          setMenu={setMenu}
        />
      )}
    </>
  );
}
