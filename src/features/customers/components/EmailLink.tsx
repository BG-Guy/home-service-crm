"use client";

import { Mail } from "lucide-react";
import { ListRow } from "@/ui/components/List";
import { toast } from "@/ui/components/Toast";
import { logCustomerEmail } from "../actions";

/** Email through the app: logs to the timeline, then opens `mailto:`. */
export function EmailLink({
  customerId,
  label = "Email",
  variant = "row",
}: {
  customerId: string;
  label?: string;
  variant?: "row" | "tile";
}) {
  const go = async () => {
    const r = await logCustomerEmail({ customerId });
    if (r.ok && r.data) window.location.href = r.data.mailto;
    else toast.error(r.ok ? "No email on file" : r.error);
  };
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
