"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

/**
 * Submit button that shows a spinner while its parent `<form action={…}>` is
 * pending (React `useFormStatus`). Must be rendered inside the form.
 *
 * ```tsx
 * <form action={save}>…<SubmitButton size="lg" fullWidth>Save</SubmitButton></form>
 * ```
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...props
}: Omit<ButtonProps, "type" | "loading"> & {
  /** Label while pending (defaults to `children`). */
  pendingLabel?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingLabel != null ? pendingLabel : children}
    </Button>
  );
}
