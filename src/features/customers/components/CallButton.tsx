"use client";

import { Phone } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { logCustomerCall, startCustomerCall } from "../actions";
import { QuickActionIcon, quickActionCls } from "./QuickActions";

// The outcome sheet (and the Sheet kit behind it) loads on the first call tap,
// not with the page (DESIGN.md §2: sheets behind first open).
const loadSheet = () => import("./CallOutcomeSheet");
const CallOutcomeSheet = dynamic(
  () => loadSheet().then((m) => m.CallOutcomeSheet),
  { ssr: false },
);

/**
 * Call through the app (SPEC §4.2): the number is fetched server-side after the
 * access check (masked numbers are revealed only to the dialer and audited), then
 * `tel:` opens and an outcome sheet logs the call.
 */
export function CallButton({
  customerId,
  jobId,
  which = "phone",
  propertyId,
  label = "Call",
  variant = "button",
  subtitle,
  disabled,
  size = 36,
}: {
  customerId: string;
  jobId?: string;
  which?: "phone" | "phoneAlt" | "site";
  propertyId?: string;
  label?: string;
  /** `round` = the labelled circle of a quick-action row. */
  variant?: "button" | "icon" | "row" | "tile" | "round";
  subtitle?: string;
  disabled?: boolean;
  /** `icon` only: circle size (36 default; 44 for hero rows). */
  size?: 36 | 44;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmEl] = useConfirm();

  const start = async () => {
    void loadSheet();
    setBusy(true);
    const res = await startCustomerCall({
      customerId,
      jobId,
      which,
      propertyId,
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Couldn't start the call" : res.error);
      return;
    }
    if (
      res.data.doNotContact &&
      !(await confirm({
        title: "Do not contact",
        message: "This customer asked not to be contacted. Call anyway?",
        confirmLabel: "Call",
      }))
    )
      return;
    window.location.href = res.data.tel;
    setArmed(true);
    setTimeout(() => setOpen(true), 600);
  };

  const sheet = (
    <>
      {confirmEl}
      {armed && (
        <CallOutcomeSheet
          open={open}
          onOpenChange={setOpen}
          onSave={async ({ outcome, notes }) => {
            const r = await logCustomerCall({
              customerId,
              jobId,
              outcome,
              notes,
              direction: "out",
              clientId: crypto.randomUUID(),
            });
            if (r.ok) toast.success("Call logged");
            else toast.error(r.error);
            return r.ok;
          }}
        />
      )}
    </>
  );

  if (variant === "round")
    return (
      <>
        <button
          type="button"
          onClick={start}
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          className={quickActionCls}
        >
          <QuickActionIcon>
            <Phone />
          </QuickActionIcon>
          <span className="max-w-full truncate">{label}</span>
        </button>
        {sheet}
      </>
    );
  if (variant === "icon")
    return (
      <>
        <IconButton
          label={label}
          variant="secondary"
          size={size}
          onClick={start}
          disabled={disabled || busy}
        >
          <Phone size={size >= 44 ? 20 : 18} />
        </IconButton>
        {sheet}
      </>
    );
  if (variant === "row")
    return (
      <>
        <ListRow
          icon={<Phone size={17} />}
          iconTone="green"
          title={label}
          subtitle={subtitle}
          onClick={start}
          disabled={disabled || busy}
          accessory="none"
        />
        {sheet}
      </>
    );
  if (variant === "tile")
    return (
      <>
        <button
          type="button"
          onClick={start}
          disabled={disabled || busy}
          className="pressable flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 rounded-card bg-card text-footnote font-medium text-accent-text shadow-card disabled:opacity-40"
        >
          <Phone size={20} aria-hidden />
          {label}
        </button>
        {sheet}
      </>
    );
  return (
    <>
      <Button
        variant="tinted"
        size="sm"
        icon={<Phone size={16} />}
        onClick={start}
        disabled={disabled || busy}
      >
        {label}
      </Button>
      {sheet}
    </>
  );
}
