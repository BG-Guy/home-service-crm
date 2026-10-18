"use client";

import { type ReactNode, useTransition } from "react";
import type { ServerAction } from "@/lib/action";
import { useConfirm } from "@/ui/components/Alert";
import { Button, type ButtonVariant } from "@/ui/components/Button";
import { toast } from "@/ui/components/Toast";

/**
 * One-tap server action button (passed in from a server component). Optional
 * confirm for destructive steps; toasts on success and on error.
 */
export function ActionButton<I, O>({
  action,
  input,
  children,
  success,
  confirm,
  variant = "gray",
  size = "sm",
  icon,
  fullWidth,
}: {
  action: ServerAction<I, O>;
  input: I;
  children: ReactNode;
  success?: string;
  confirm?: {
    title: string;
    message?: string;
    label?: string;
    destructive?: boolean;
  };
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  fullWidth?: boolean;
}) {
  const [pending, start] = useTransition();
  const [ask, confirmEl] = useConfirm();
  const run = async () => {
    if (
      confirm &&
      !(await ask({
        title: confirm.title,
        message: confirm.message,
        confirmLabel: confirm.label,
        destructive: confirm.destructive,
      }))
    )
      return;
    start(async () => {
      const r = await action(input as I);
      if (!r.ok) toast({ title: r.error, tone: "error" });
      else if (success) toast({ title: success, tone: "success" });
    });
  };
  return (
    <>
      <Button
        variant={variant}
        size={size}
        loading={pending}
        icon={icon}
        fullWidth={fullWidth}
        onClick={run}
      >
        {children}
      </Button>
      {confirmEl}
    </>
  );
}
