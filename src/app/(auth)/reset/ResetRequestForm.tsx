"use client";

import { MailCheck } from "lucide-react";
import { requestPasswordResetAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { TextField } from "@/ui/components/Field";
import { useAuthForm } from "../_components/useAuthForm";

export function ResetRequestForm() {
  const f = useAuthForm(requestPasswordResetAction);
  if (f.succeeded) {
    return (
      <div className="list-card">
        <EmptyState
          compact
          icon={<MailCheck size={44} />}
          title="Check your email"
          message="If an account exists for that address, a reset link is on its way. It works once and expires in 30 minutes. No email? Ask your admin for a reset link."
        />
      </div>
    );
  }
  return (
    <form
      action={f.action}
      onSubmit={f.onSubmit}
      className="flex flex-col gap-4"
      noValidate
    >
      {f.formError && <Banner tone="error">{f.formError}</Banner>}
      <TextField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
        error={f.fieldErrors.email}
      />
      <Button type="submit" size="lg" fullWidth loading={f.pending}>
        Send reset link
      </Button>
    </form>
  );
}
