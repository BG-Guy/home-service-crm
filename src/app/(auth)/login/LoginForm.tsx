"use client";

import Link from "next/link";
import { loginAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { TextField } from "@/ui/components/Field";
import { ToggleRow } from "@/ui/components/Toggle";
import { useAuthForm } from "../_components/useAuthForm";

export function LoginForm({ next }: { next: string }) {
  const f = useAuthForm(loginAction);
  return (
    <form
      action={f.action}
      onSubmit={f.onSubmit}
      className="flex flex-col gap-4"
      noValidate
    >
      {next && <input type="hidden" name="next" value={next} />}
      {f.formError && <Banner tone="error">{f.formError}</Banner>}
      <TextField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
        error={f.fieldErrors.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={f.fieldErrors.password}
      />
      <div className="-mt-2 flex justify-end px-1">
        <Link href="/reset" className="text-subhead text-accent-text">
          Forgot password?
        </Link>
      </div>
      <div className="list-card">
        <ToggleRow
          title="Keep me signed in"
          subtitle="For 30 days on this device"
          name="remember"
          value="true"
          defaultChecked
        />
      </div>
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={f.pending}
        className="mt-1"
      >
        Sign in
      </Button>
    </form>
  );
}
