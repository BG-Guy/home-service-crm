"use client";

import { acceptInviteAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { FieldError, TextField } from "@/ui/components/Field";
import { PhoneField } from "@/ui/components/PhoneField";
import { ToggleRow } from "@/ui/components/Toggle";
import { useAuthForm } from "../../_components/useAuthForm";

type Policy = { title: string; body: string };

export function AcceptInviteForm({
  token,
  invite,
  esign,
  monitoring,
}: {
  token: string;
  invite: {
    name: string;
    email: string | null;
    phone: string | null;
    baseRole: "admin" | "office" | "tech";
  };
  esign: Policy;
  monitoring: Policy | null;
}) {
  const f = useAuthForm(acceptInviteAction);
  const e = f.fieldErrors;
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
        label="Your name"
        name="name"
        autoComplete="name"
        defaultValue={invite.name}
        required
        error={e.name}
      />
      {invite.email ? (
        <TextField
          label="Email"
          type="email"
          value={invite.email}
          readOnly
          hint="Your admin set this. You'll use it to sign in."
        />
      ) : (
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
      )}
      <PhoneField
        label="Mobile"
        name="phone"
        defaultValue={invite.phone ?? ""}
        error={e.phone}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        autoFocus
        hint="At least 10 characters. Avoid common passwords."
        error={e.password}
      />

      {monitoring && (
        <section className="flex flex-col gap-2">
          <Banner tone="legal" title={monitoring.title}>
            {monitoring.body}
          </Banner>
          <div className="list-card">
            <ToggleRow
              title="I've read the monitoring notice"
              name="monitoringAck"
              value="true"
            />
          </div>
          <FieldError>{e.monitoringAck?.join(" ")}</FieldError>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <details className="list-card px-4 py-3 text-subhead">
          <summary className="cursor-pointer font-medium">
            {esign.title}
          </summary>
          <p className="mt-2 whitespace-pre-line text-label-2">{esign.body}</p>
        </details>
        <div className="list-card">
          <ToggleRow
            title="I agree to electronic records and signatures"
            name="esignConsent"
            value="true"
          />
        </div>
        <FieldError>{e.esignConsent?.join(" ")}</FieldError>
      </section>

      <input type="hidden" name="remember" value="true" />
      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={f.pending}
        className="mt-1"
      >
        Join team
      </Button>
    </form>
  );
}
