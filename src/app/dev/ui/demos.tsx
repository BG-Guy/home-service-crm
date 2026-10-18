"use client";

// Interactive demos for the dev UI gallery (QA screenshots). Not shipped in nav.

import {
  Archive,
  Flag,
  Monitor,
  Moon,
  Pencil,
  Phone,
  Sun,
  Trash,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionSheet } from "@/ui/components/ActionSheet";
import { AddMenu } from "@/ui/components/AddMenu";
import { Alert, useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { CameraButton } from "@/ui/components/CameraButton";
import { ConfirmTyped } from "@/ui/components/ConfirmTyped";
import { ContextMenu } from "@/ui/components/ContextMenu";
import { TextArea, TextField } from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { InstallPrompt } from "@/ui/components/InstallPrompt";
import { ListRow, ListSection } from "@/ui/components/List";
import {
  LazyMapView,
  LazyPhotoCompare,
  LazySignaturePad,
} from "@/ui/components/lazy";
import { MoneyField } from "@/ui/components/MoneyField";
import { PhoneField } from "@/ui/components/PhoneField";
import { type Photo, PhotoGrid } from "@/ui/components/PhotoGrid";
import { SearchField } from "@/ui/components/SearchField";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { Sheet, useSheetState } from "@/ui/components/Sheet";
import type { SignaturePadHandle } from "@/ui/components/SignaturePad";
import { Stepper } from "@/ui/components/Stepper";
import { SubmitButton } from "@/ui/components/SubmitButton";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { toast } from "@/ui/components/Toast";
import { ToggleRow } from "@/ui/components/Toggle";

/* ---------- helpers ---------- */

/** Placeholder photo as an SVG data URI (no network in the gallery). */
export function fakePhoto(
  label: string,
  hue: number,
  w = 640,
  h = 480,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 35%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="52%" font-family="system-ui" font-size="${Math.round(w / 9)}" font-weight="700" fill="white" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PHOTOS: Photo[] = [
  ["Before", 20, "before"],
  ["Before 2", 35, "before"],
  ["Lock", 200, "problem"],
  ["After", 130, "after"],
  ["After 2", 150, "after"],
  ["Receipt", 260, "receipt"],
].map(([label, hue, tag], i) => ({
  id: `p${i}`,
  thumbUrl: fakePhoto(String(label), Number(hue), 320, 320),
  url: fakePhoto(String(label), Number(hue), 1600, 1200),
  tag: String(tag),
  caption: i === 0 ? "Front door deadbolt, seized cylinder" : null,
  takenAt: "Oct 14, 3:45 PM",
  starred: i === 3,
}));

/* ---------- theme ---------- */

export function ThemeToggle() {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  return (
    <SegmentedControl
      label="Theme"
      value={theme}
      onChange={setTheme}
      className="w-[168px]"
      segments={[
        { value: "system", label: <Monitor size={15} aria-label="System" /> },
        { value: "light", label: <Sun size={15} aria-label="Light" /> },
        { value: "dark", label: <Moon size={15} aria-label="Dark" /> },
      ]}
    />
  );
}

export function GalleryAddMenu() {
  return (
    <AddMenu
      title="Create"
      items={[
        { label: "New Job", onSelect: () => toast("New job") },
        { label: "New Lead", onSelect: () => toast("New lead") },
        { label: "New Customer", onSelect: () => toast("New customer") },
        { label: "New Estimate", onSelect: () => toast("New estimate") },
      ]}
    />
  );
}

/* ---------- overlays ---------- */

export function OverlayDemos() {
  const sheet = useSheetState();
  const form = useSheetState();
  const panel = useSheetState();
  const [note, setNote] = useState("");
  const [action, setAction] = useState(false);
  const [alert, setAlert] = useState(false);
  const [typed, setTyped] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="tinted" onClick={sheet.show}>
        Sheet (medium → large)
      </Button>
      <Button variant="tinted" onClick={form.show}>
        Form sheet (dirty)
      </Button>
      <Button variant="tinted" onClick={panel.show}>
        Detail panel (desktop)
      </Button>
      <Button variant="gray" onClick={() => setAction(true)}>
        Action sheet
      </Button>
      <Button variant="gray" onClick={() => setAlert(true)}>
        Alert
      </Button>
      <Button
        variant="gray"
        onClick={async () => {
          const ok = await confirm({
            title: "Archive this job?",
            message: "You can restore it from Archived.",
            confirmLabel: "Archive",
          });
          toast(ok ? "Archived" : "Kept");
        }}
      >
        useConfirm()
      </Button>
      <Button variant="destructive" onClick={() => setTyped(true)}>
        Type to confirm
      </Button>

      <Sheet
        {...sheet.props}
        title="Choose a Technician"
        detents={["medium", "large"]}
        leading={
          <Button variant="plain" size="sm" onClick={sheet.hide}>
            Cancel
          </Button>
        }
      >
        <p className="mb-4 text-subhead text-label-2">
          Drag the grabber, flick down to dismiss, or scroll to expand.
        </p>
        <ListSection header="Available">
          {[
            "Alex",
            "Brianna",
            "Carlos",
            "Dana",
            "Eli",
            "Farah",
            "Gus",
            "Hana",
            "Ivan",
            "Jo",
          ].map((n) => (
            <ListRow
              key={n}
              title={n}
              subtitle="2 jobs today"
              onClick={sheet.hide}
            />
          ))}
        </ListSection>
      </Sheet>

      <Sheet
        {...form.props}
        title="New Note"
        dirty={note.trim() !== ""}
        detents={["large"]}
        leading={
          <Button variant="plain" size="sm" onClick={() => form.setOpen(false)}>
            Cancel
          </Button>
        }
        trailing={
          <Button
            variant="plain"
            size="sm"
            className="font-semibold"
            disabled={!note.trim()}
            onClick={() => {
              setNote("");
              form.hide();
              toast.success("Note saved");
            }}
          >
            Save
          </Button>
        }
        onClosed={() => setNote("")}
      >
        <TextArea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder="Type to make the sheet dirty, then try to dismiss"
          rows={6}
        />
      </Sheet>

      <Sheet
        {...panel.props}
        title="Job #1042"
        desktop="panel"
        trailing={
          <Button variant="plain" size="sm" onClick={panel.hide}>
            Done
          </Button>
        }
      >
        <p className="text-body">
          On desktop this opens as a right-side panel; on phones it&apos;s a
          sheet.
        </p>
      </Sheet>

      <ActionSheet
        open={action}
        onOpenChange={setAction}
        title="Photo"
        message="What would you like to do with this photo?"
        items={[
          { label: "Star for Invoice", onSelect: () => toast("Starred") },
          { label: "Change Tag", onSelect: () => toast("Tag") },
          {
            label: "Delete Photo",
            destructive: true,
            onSelect: () => toast("Deleted"),
          },
        ]}
      />
      <Alert
        open={alert}
        onOpenChange={setAlert}
        title="Mark as Arrived?"
        message="We'll record your location as evidence."
        actions={[
          { label: "Cancel", style: "cancel" },
          {
            label: "Arrived",
            preferred: true,
            onPress: () => toast.success("Arrived"),
          },
        ]}
      />
      <ConfirmTyped
        open={typed}
        onOpenChange={setTyped}
        title="Delete 24 customers?"
        message="This removes them and their jobs from lists. It can't be undone."
        phrase="DELETE"
        onConfirm={() => new Promise((r) => setTimeout(r, 1200))}
      />
      {confirmEl}
    </div>
  );
}

/* ---------- toasts ---------- */

export function ToastDemos() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="gray" onClick={() => toast("Job scheduled")}>
        Default
      </Button>
      <Button
        variant="gray"
        onClick={() =>
          toast.success("Payment recorded", { message: "$245.00 · Visa 4242" })
        }
      >
        Success
      </Button>
      <Button
        variant="gray"
        onClick={() =>
          toast.error("Couldn't send", { message: "Check the phone number" })
        }
      >
        Error
      </Button>
      <Button
        variant="gray"
        onClick={() =>
          toast({
            title: "Lead archived",
            undo: () => toast("Restored"),
          })
        }
      >
        With undo
      </Button>
      <Button
        variant="gray"
        onClick={() => {
          for (let i = 1; i <= 4; i++) toast(`Queued toast ${i}`);
        }}
      >
        Burst of 4 (max 3)
      </Button>
    </div>
  );
}

/* ---------- controls ---------- */

export function ControlDemos() {
  const [view, setView] = useState("day");
  const [qty, setQty] = useState(1);
  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl
        label="Schedule view"
        value={view}
        onChange={setView}
        segments={[
          { value: "day", label: "Day" },
          { value: "3day", label: "3 Day" },
          { value: "week", label: "Week" },
        ]}
      />
      <SegmentedControl
        label="Disabled segment"
        defaultValue="a"
        segments={[
          { value: "a", label: "Before" },
          { value: "b", label: "During" },
          { value: "c", label: "After" },
          { value: "d", label: "Other", disabled: true },
        ]}
      />
      <ListSection
        header="Toggles & steppers"
        footer="Rows are labels: tap anywhere."
      >
        <ToggleRow title="Share location while clocked in" defaultChecked />
        <ToggleRow title="Quiet hours" subtitle="No texts 9 PM – 8 AM" />
        <ToggleRow title="Disabled" disabled />
        <div className="list-row flex min-h-11 items-center justify-between px-4">
          <span className="text-body">Quantity</span>
          <Stepper
            label="Quantity"
            value={qty}
            onChange={setQty}
            min={1}
            max={20}
          />
        </div>
      </ListSection>
    </div>
  );
}

/* ---------- fields ---------- */

export function FieldDemos() {
  return (
    <form
      className="flex flex-col gap-4"
      action={async () => {
        await new Promise((r) => setTimeout(r, 1500));
        toast.success("Saved");
      }}
    >
      <SearchField
        placeholder="Search customers"
        onSearch={(q) => q && toast(`Search: ${q}`)}
      />
      <MoneyField name="amountCents" label="Amount" defaultCents={12500} />
      <MoneyField
        name="discount"
        label="Discount (starts at $0)"
        defaultCents={0}
      />
      <MoneyField
        name="tip"
        label="Tip (with error)"
        error="Tip can't exceed 50% of the total"
      />
      <PhoneField
        name="phone"
        label="Mobile phone"
        hint="We'll text appointment updates."
      />
      <TextField
        name="email"
        type="email"
        label="Email"
        placeholder="name@example.com"
      />
      <ListSection header="Row layout">
        <TextField layout="row" label="First" placeholder="Required" />
        <TextField layout="row" label="Last" placeholder="Required" />
        <PhoneField layout="row" label="Phone" />
        <MoneyField layout="row" label="Price" />
      </ListSection>
      <SubmitButton size="lg" fullWidth pendingLabel="Saving…">
        Save (useFormStatus)
      </SubmitButton>
    </form>
  );
}

/* ---------- gestures ---------- */

export function GestureDemos() {
  return (
    <ListSection
      header="Swipe rows & context menus"
      footer="Swipe a row left/right, long-press (touch), right-click or Shift+F10."
    >
      {["Jordan Lee", "Sam Patel", "Riley Chen"].map((n) => (
        <SwipeActions
          key={n}
          leading={[
            {
              label: "Flag",
              tone: "orange",
              icon: <Flag size={18} />,
              onAction: () => toast(`Flagged ${n}`),
            },
          ]}
          trailing={[
            {
              label: "Archive",
              tone: "indigo",
              icon: <Archive size={18} />,
              onAction: () =>
                toast({
                  title: `Archived ${n}`,
                  undo: () => toast("Restored"),
                }),
            },
            {
              label: "Delete",
              destructive: true,
              icon: <Trash size={18} />,
              onAction: () => toast.error(`Deleted ${n}`),
            },
          ]}
        >
          <ListRow
            title={n}
            subtitle="Lockout · 2 days ago"
            detail="$180"
            onClick={() => toast(`Open ${n}`)}
            accessory="chevron"
            className="bg-card"
          />
        </SwipeActions>
      ))}
      <ContextMenu
        actions={[
          {
            label: "Call",
            icon: <Phone size={17} />,
            onSelect: () => toast("Calling…"),
          },
          {
            label: "Edit",
            icon: <Pencil size={17} />,
            onSelect: () => toast("Edit"),
          },
          {
            label: "Delete",
            icon: <Trash size={17} />,
            destructive: true,
            onSelect: () => toast.error("Deleted"),
          },
        ]}
      >
        <ListRow
          title="Context menu only"
          subtitle="Long-press or right-click"
          onClick={() => {}}
        />
      </ContextMenu>
    </ListSection>
  );
}

/* ---------- media ---------- */

export function MediaDemos() {
  const sig = useRef<SignaturePadHandle>(null);
  const [signed, setSigned] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PhotoGrid photos={PHOTOS} />
      <LazyPhotoCompare
        beforeUrl={fakePhoto("BEFORE", 20, 1200, 900)}
        afterUrl={fakePhoto("AFTER", 140, 1200, 900)}
      />
      <div className="flex flex-col gap-2">
        <LazySignaturePad ref={sig} onChange={(e) => setSigned(!e)} />
        <Button
          variant="tinted"
          disabled={!signed}
          onClick={() => {
            const url = sig.current?.toDataURL();
            toast.success("Signature captured", {
              message: url ? `${Math.round(url.length / 1024)} KB PNG` : "",
            });
          }}
        >
          Export PNG
        </Button>
      </div>
      <CameraButton
        tag="before"
        geo={false}
        upload={async (_file, meta, { onProgress }) => {
          // Fake uploader for the gallery: simulated progress, no network.
          for (let i = 1; i <= 10; i++) {
            await new Promise((r) => setTimeout(r, 120));
            onProgress?.(i / 10);
          }
          return {
            clientId: meta.clientId,
            queued: false,
            mediaId: meta.clientId,
          };
        }}
        onUploaded={() => toast.success("Photo uploaded")}
      />
    </div>
  );
}

export function MapDemo() {
  const [sel, setSel] = useState<string | null>("t1");
  return (
    <LazyMapView
      label="Technicians"
      selectedId={sel}
      onSelect={setSel}
      markers={[
        {
          id: "t1",
          lat: 40.7128,
          lng: -74.006,
          label: "AL",
          title: "Alex",
          tone: "blue",
          pulse: true,
        },
        {
          id: "t2",
          lat: 40.73,
          lng: -73.99,
          label: "BR",
          title: "Brianna",
          tone: "orange",
        },
        {
          id: "j1",
          lat: 40.7,
          lng: -74.02,
          label: "J",
          title: "Job #1042",
          tone: "green",
        },
      ]}
    />
  );
}

export function InstallDemo() {
  return (
    <ListSection
      header="Install"
      footer="Hidden when already installed (standalone)."
    >
      <InstallPrompt variant="row" appName="CRM" />
    </ListSection>
  );
}

export function IconButtonDemo() {
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Call" onClick={() => toast("Call")}>
        <Phone size={22} />
      </IconButton>
      <IconButton
        label="Call"
        variant="gray"
        size={36}
        onClick={() => toast("Call")}
      >
        <Phone size={18} />
      </IconButton>
      <IconButton
        label="Call"
        variant="filled"
        size={36}
        onClick={() => toast("Call")}
      >
        <Phone size={18} />
      </IconButton>
      <IconButton
        label="Call"
        variant="material"
        size={44}
        onClick={() => toast("Call")}
      >
        <Phone size={20} />
      </IconButton>
      <IconButton label="Disabled" disabled>
        <Phone size={22} />
      </IconButton>
    </div>
  );
}
