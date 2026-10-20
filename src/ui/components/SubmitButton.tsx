"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

/**
 * Submit button that shows a spinner while its parent `<form action={…}>` is
 * pending (React `useFormStatus`). Must be rendered inside the form. The label
 * keeps its width under the spinner; `pendingLabel` shows text next to it instead.
 *
 * ```tsx
 * <form action={save}>…<SubmitButton size="lg" block>Save</SubmitButton></form>
 * ```
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...props
}: Omit<ButtonProps, "type" | "loading" | "loadingText"> & {
  /** Label while pending, shown next to the spinner (defaults to the spinner alone). */
  pendingLabel?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      loading={pending}
      loadingText={pendingLabel}
      {...props}
    >
      {children}
    </Button>
  );
}
