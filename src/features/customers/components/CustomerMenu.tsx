"use client";

import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CustomFieldDef } from "@/features/settings/contracts";
import { ActionSheet, type ActionSheetItem } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ConfirmTyped } from "@/ui/components/ConfirmTyped";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";
import { anonymizeCustomer, deleteCustomer } from "../actions";
import type { CustomerEditable } from "../contracts";
import { CustomerForm } from "./CustomerForm";

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
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const [anon, setAnon] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const id = customer?.id;

  const items: ActionSheetItem[] = [];
  if (canMerge && id && !anonymized)
    items.push({
      label: "Merge with another customer…",
      href: `/customers/${id}/merge`,
    });
  if (canDelete && id) {
    items.push({
      label: archived ? "Restore customer" : "Archive customer",
      destructive: !archived,
      onSelect: async () => {
        if (
          !archived &&
          !(await confirm({
            title: "Archive this customer?",
            message:
              "They disappear from lists and search. Jobs, invoices and payments are kept. You can restore them later.",
            confirmLabel: "Archive",
            destructive: true,
          }))
        )
          return;
        const r = await deleteCustomer({ id, restore: archived });
        if (r.ok)
          toast.success(archived ? "Customer restored" : "Customer archived");
        else toast.error(r.error);
      },
    });
    if (!anonymized)
      items.push({
        label: "Anonymize (privacy request)…",
        destructive: true,
        onSelect: () => setAnon(true),
      });
  }

  return (
    <>
      {canEdit && customer && !anonymized && (
        <Button variant="plain" size="sm" onClick={() => setEdit(true)}>
          Edit
        </Button>
      )}
      {items.length > 0 && (
        <IconButton label="More actions" onClick={() => setMenu(true)}>
          <Ellipsis size={22} />
        </IconButton>
      )}
      <ActionSheet open={menu} onOpenChange={setMenu} items={items} />
      {confirmEl}
      {customer && (
        <Sheet
          open={edit}
          onOpenChange={setEdit}
          title="Edit customer"
          detents={["large"]}
          desktop="panel"
          leading={
            <Button variant="plain" size="sm" onClick={() => setEdit(false)}>
              Cancel
            </Button>
          }
          trailing={
            <Button
              variant="plain"
              size="sm"
              type="submit"
              form="customer-edit-form"
              className="font-semibold"
            >
              Save
            </Button>
          }
        >
          <div className="pb-8">
            <CustomerForm
              mode="edit"
              formId="customer-edit-form"
              initial={customer}
              customDefs={customDefs}
              onSaved={() => setEdit(false)}
            />
          </div>
        </Sheet>
      )}
      {id && (
        <ConfirmTyped
          open={anon}
          onOpenChange={setAnon}
          title="Anonymize customer?"
          message="Name, phone, email, addresses, notes and message bodies are replaced with placeholders. Invoices and payments are kept for your books. This cannot be undone."
          phrase="ANONYMIZE"
          confirmLabel="Anonymize"
          pendingLabel="Anonymizing…"
          onConfirm={async () => {
            const r = await anonymizeCustomer({ id, confirm: "ANONYMIZE" });
            if (r.ok) {
              toast.success("Customer anonymized");
              router.refresh();
            } else toast.error(r.error);
          }}
        />
      )}
    </>
  );
}
