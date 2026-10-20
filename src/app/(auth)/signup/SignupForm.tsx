"use client";

import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { signupAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { Select, TextField } from "@/ui/components/Field";
import { PhoneField } from "@/ui/components/PhoneField";
import { useAuthForm } from "../_components/useAuthForm";
import { TRADE_PRESETS, US_STATES, US_TIME_ZONES } from "./options";

const STATE_OPTIONS = US_STATES.map(([value, label]) => ({ value, label }));

/**
 * `company`: first run — company name, trade, time zone and state, plus the admin.
 * `join`: open signup — only the person; the account waits for approval.
 */
export function SignupForm({
  mode,
  companyName,
}: {
  mode: "company" | "join";
  companyName?: string;
}) {
  const f = useAuthForm(signupAction);
  // Detected after mount (Intl), so server and client render the same markup.
  const [tz, setTz] = useState<string>("America/New_York");
  const [tzOptions, setTzOptions] =
    useState<readonly { value: string; label: string }[]>(US_TIME_ZONES);
  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!detected) return;
      setTz(detected);
      if (!US_TIME_ZONES.some((z) => z.value === detected))
        setTzOptions([
          { value: detected, label: detected.replaceAll("_", " ") },
          ...US_TIME_ZONES,
        ]);
    } catch {
      /* keep the default */
    }
  }, []);

  if (f.succeeded) {
    return (
      <div className="list-card">
        <EmptyState
          compact
          icon={<CircleCheck size={44} />}
          title="Request sent"
          message="An admin needs to approve your account. You'll be able to sign in once they do."
          action={
            <Button href="/login" variant="tinted">
              Back to sign in
            </Button>
          }
        />
      </div>
    );
  }

  const e = f.fieldErrors;
  return (
    <form
      action={f.action}
      onSubmit={f.onSubmit}
      className="flex flex-col gap-4"
      noValidate
    >
      {f.formError && <Banner tone="error">{f.formError}</Banner>}

      {mode === "company" ? (
        <>
          <TextField
            label="Company name"
            name="companyName"
            autoComplete="organization"
            placeholder="Acme Locksmith"
            required
            autoFocus
            error={e.companyName}
          />
          <Select
            label="Trade"
            name="tradePreset"
            defaultValue="generic"
            options={TRADE_PRESETS}
            hint="Sets up starter service types. You can change everything later."
            error={e.tradePreset}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Time zone"
              name="timezone"
              value={tz}
              onChange={(ev) => setTz(ev.target.value)}
              options={tzOptions}
              error={e.timezone}
            />
            <Select
              label="State"
              name="state"
              defaultValue=""
              placeholder="Select…"
              options={STATE_OPTIONS}
              hint="For your compliance defaults."
              error={e.state}
            />
          </div>
          <h2 className="mt-3 px-1 text-headline">Your admin account</h2>
        </>
      ) : (
        <input type="hidden" name="companyName" value={companyName ?? ""} />
      )}

      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        required
        autoFocus={mode === "join"}
        error={e.name}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        error={e.email}
      />
      <PhoneField
        label="Mobile"
        name="phone"
        hint="Optional. Used for job alerts and sign-in help."
        error={e.phone}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        hint="At least 10 characters. Avoid common passwords."
        error={e.password}
      />
      <input type="hidden" name="remember" value="true" />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={f.pending}
        className="mt-1"
      >
        {mode === "company" ? "Create workspace" : "Request account"}
      </Button>
      {mode === "company" && (
        <p className="px-1 text-center text-footnote text-label-2">
          You'll be the admin. Invite your team from Settings afterwards.
        </p>
      )}
    </form>
  );
}
