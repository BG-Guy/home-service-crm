"use client";

import { Archive, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { ContextMenu } from "@/ui/components/ContextMenu";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { toast } from "@/ui/components/Toast";

type SheetKind = "large" | "medium" | "modal" | "drawer" | null;

/** Shell gallery, overlays: M4 sheets, M4d modal/drawer, M5 menus, M6 alert, M7 toast. */
export function OverlayDemos() {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [actions, setActions] = useState(false);
  const [confirm, confirmEl] = useConfirm();
  const close = () => setSheet(null);

  const demo = (id: string, label: string, onClick: () => void) => (
    <Button data-demo={id} variant="secondary" onClick={onClick}>
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <section className="flex flex-col gap-3">
        <h2 className="text-title3 font-bold">Sheets</h2>
        <p className="text-subhead text-label-2">
          Phone: slides up on a 320 ms spring; at the large detent the page
          behind steps back (card stack). Desktop: a centered modal, or a drawer
          for long forms.
        </p>
        <div className="flex flex-wrap gap-2">
          {demo("sheet-large", "Large sheet", () => setSheet("large"))}
          {demo("sheet-medium", "Medium → large", () => setSheet("medium"))}
          {demo("sheet-modal", "Modal", () => setSheet("modal"))}
          {demo("sheet-drawer", "Drawer", () => setSheet("drawer"))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title3 font-bold">Menus and alerts</h2>
        <div className="flex flex-wrap items-center gap-2">
          {demo("action-sheet", "Action sheet", () => setActions(true))}
          {demo("alert", "Alert", async () => {
            if (
              await confirm({
                title: "Send the invoice?",
                message: "Daniel gets a text and an email with the pay link.",
                confirmLabel: "Send",
              })
            )
              toast.success("Invoice sent");
          })}
          {demo("alert-destructive", "Destructive alert", async () => {
            if (
              await confirm({
                title: "Delete this photo?",
                message: "This can't be undone.",
                confirmLabel: "Delete",
                destructive: true,
              })
            )
              toast({ title: "Photo deleted", undo: () => toast("Restored") });
          })}
          <IconButton
            label="More actions"
            data-demo="more"
            variant="secondary"
            onClick={() => setActions(true)}
          >
            <MoreHorizontal aria-hidden size={20} />
          </IconButton>
        </div>
        <ContextMenu
          label="Job actions"
          actions={[
            {
              label: "Edit",
              icon: <Pencil size={18} />,
              onSelect: () => toast("Edit"),
            },
            {
              label: "Duplicate",
              icon: <Copy size={18} />,
              onSelect: () => toast("Duplicated"),
            },
            {
              label: "Archive",
              icon: <Archive size={18} />,
              onSelect: () => toast("Archived"),
            },
            {
              label: "Delete",
              icon: <Trash2 size={18} />,
              destructive: true,
              onSelect: () => toast.error("Deleted"),
            },
          ]}
        >
          <div
            data-demo="context-target"
            className="rounded-card bg-card p-5 shadow-card"
          >
            <div className="text-headline">Long-press or right-click me</div>
            <div className="text-subhead text-label-2">
              The menu grows from the press point.
            </div>
          </div>
        </ContextMenu>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title3 font-bold">Toasts</h2>
        <div className="flex flex-wrap gap-2">
          {demo("toast-success", "Success", () =>
            toast.success("Payment received", {
              message: "$334.54 · Visa 4242",
            }),
          )}
          {demo("toast-error", "Error", () =>
            toast.error("Couldn't send the text", {
              message: "The number looks unreachable.",
            }),
          )}
          {demo("toast-undo", "With undo", () =>
            toast({ title: "Job archived", undo: () => toast("Restored") }),
          )}
          {demo("toast-default", "Info", () => toast("Synced 3 changes"))}
        </div>
      </section>

      <ActionSheet
        open={actions}
        onOpenChange={setActions}
        title="J-1042"
        items={[
          { label: "Edit job", onSelect: () => toast("Edit") },
          { label: "Reschedule", onSelect: () => toast("Reschedule") },
          {
            label: "Cancel job",
            destructive: true,
            onSelect: () => toast.error("Cancelled"),
          },
        ]}
      />
      {confirmEl}

      <Sheet
        open={sheet === "large" || sheet === "medium"}
        onOpenChange={(o) => !o && close()}
        title="New note"
        detents={sheet === "medium" ? ["medium", "large"] : ["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={close}>
            Cancel
          </Button>
        }
        footer={
          <Button block size="lg" data-demo="sheet-save" onClick={close}>
            Save note
          </Button>
        }
      >
        <ListSection header="Job">
          <ListRow title="J-1042 · Rekey front and back doors" />
          <ListRow title="Daniel Johnson" subtitle="8071 E Riverside Dr" />
        </ListSection>
        <p className="mt-6 text-body text-label-2">
          The primary action lives in the sticky footer, above the safe area and
          the keyboard, while this body scrolls.
        </p>
        {Array.from({ length: 8 }, (_, i) => (
          <p
            // biome-ignore lint/suspicious/noArrayIndexKey: static filler
            key={i}
            className="mt-4 text-body"
          >
            Line {i + 1}: drag the grabber down to dismiss; a fast flick carries
            its velocity into the spring.
          </p>
        ))}
      </Sheet>

      <Sheet
        open={sheet === "modal" || sheet === "drawer"}
        onOpenChange={(o) => !o && close()}
        title={sheet === "drawer" ? "Edit job" : "Assign tech"}
        presentation={sheet === "drawer" ? "drawer" : "modal"}
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={close}>
            Cancel
          </Button>
        }
        footer={
          <Button block size="lg" onClick={close}>
            {sheet === "drawer" ? "Save changes" : "Assign"}
          </Button>
        }
      >
        <ListSection header="Technicians">
          {["Tom Baker", "Ana Ruiz", "Marcus Lee", "Priya Shah"].map((n) => (
            <ListRow key={n} title={n} subtitle="Available after 2:00 PM" />
          ))}
        </ListSection>
      </Sheet>
    </div>
  );
}
