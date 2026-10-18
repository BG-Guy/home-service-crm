"use client";

import { completePasswordResetAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { useAuthForm } from "../../_components/useAuthForm";

export function NewPasswordForm({ token }: { token: string }) {
  const f = useAuthForm(completePasswordResetAction);
  return (
    <form
      action={f.action}
      onSubmit={f.onSubmit}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="token" value={token} />
      {f.formError && <Banner tone="error">{f.formError}</Banner>}
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        autoFocus
        hint="At least 10 characters. Avoid common passwords."
        error={f.fieldErrors.password}
      />
      <Button type="submit" size="lg" fullWidth loading={f.pending}>
        Save and sign in
      </Button>
    </form>
  );
}
