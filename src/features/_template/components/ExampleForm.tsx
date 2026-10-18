"use client";

import { useActionState } from "react";
import { TextField } from "@/ui/components/Field";
import { SubmitButton } from "@/ui/components/SubmitButton";
import { createExampleItem } from "../actions";

// Client island: a form bound to a server action with useActionState. Field errors
// come back as `fieldErrors` from action(); success triggers refresh() server-side,
// so the server list above re-renders without manual state.
export function ExampleForm() {
  const [state, formAction] = useActionState(createExampleItem, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="flex items-end gap-2">
      <TextField
        label="New item"
        name="title"
        placeholder="Call back Mrs. Lee"
        className="flex-1"
        error={errors?.title ?? (state && !state.ok ? state.error : null)}
      />
      <SubmitButton>Add</SubmitButton>
    </form>
  );
}
