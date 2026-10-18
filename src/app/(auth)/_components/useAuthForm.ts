"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import type { ActionResult } from "@/lib/types";

type AuthAction<T> = (
  prev: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>>;

/**
 * useActionState for the auth forms, submitted through `onSubmit` so React does
 * not reset the fields after a failed attempt (a native form action would).
 * Unchecked checkboxes are sent as "" (false) instead of being omitted, so
 * zod's boolean defaults don't flip them back on. Without JS the form still
 * posts natively through `action`.
 */
export function useAuthForm<T>(serverAction: AuthAction<T>) {
  const [state, dispatch, pending] = useActionState<
    ActionResult<T> | null,
    FormData
  >(serverAction, null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    for (const el of form.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][name]',
    )) {
      if (!el.checked) fd.set(el.name, "");
    }
    startTransition(() => dispatch(fd));
  }

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};
  // A form-level message only when no specific field carries the error.
  const formError =
    failed && Object.keys(fieldErrors).filter((k) => k !== "_").length === 0
      ? (fieldErrors._?.join(" ") ?? failed.error)
      : null;
  return {
    state,
    pending,
    action: dispatch,
    onSubmit,
    fieldErrors,
    formError,
    succeeded: state?.ok === true ? state : null,
  };
}
