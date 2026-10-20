"use client";

import { Mail } from "lucide-react";
import { ListRow } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { logCustomerEmail } from "../actions";
import { QuickActionIcon, quickActionCls } from "./QuickActions";

/** Email through the app: logs to the timeline, then opens `mailto:`. */
export function EmailLink({
  customerId,
  label = "Email",
  variant = "row",
}: {
  customerId: string;
  label?: string;
  variant?: "row" | "tile" | "round";
}) {
  const go = async () => {
    const r = await logCustomerEmail({ customerId });
    if (r.ok && r.data) window.location.href = r.data.mailto;
    else toast.error(r.ok ? "No email on file" : r.error);
  };
  if (variant === "round")
    return (
      <button type="button" onClick={go} className={quickActionCls}>
        <QuickActionIcon>
          <Mail />
        </QuickActionIcon>
        <span>Email</span>
      </button>
    );
  if (variant === "tile")
    return (
      <button
        type="button"
        onClick={go}
        className="pressable flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 rounded-card bg-card text-footnote font-medium text-accent-text shadow-card"
      >
        <Mail size={20} aria-hidden />
        Email
      </button>
    );
  return (
    <ListRow
      icon={<Mail size={17} />}
      iconTone="indigo"
      title={label}
      onClick={go}
      accessory="none"
    />
  );
}
