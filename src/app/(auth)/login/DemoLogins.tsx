"use client";

import { useState, useTransition } from "react";
import { demoLoginAction } from "@/features/auth/actions";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";

const LABEL: Record<string, string> = {
  admin: "Admin",
  office: "Office",
  tech: "Tech",
};

/** Demo businesses only (DEMO_LOGIN_PASSWORD): sign in as a role with one tap. */
export function DemoLogins({
  users,
}: {
  users: { role: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section
      aria-label="Demo sign-in"
      className="flex flex-col gap-3 rounded-card bg-fill-2 p-4"
    >
      <p className="text-footnote text-label-2">
        Demo business: sign in with one tap.
      </p>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid grid-cols-3 gap-2">
        {users.map((u) => (
          <Button
            key={u.role}
            variant="secondary"
            block
            loading={pending && busy === u.role}
            disabled={pending}
            onClick={() => {
              setBusy(u.role);
              setError(null);
              start(async () => {
                const r = await demoLoginAction(u.role);
                if (r && !r.ok) setError(r.error);
              });
            }}
          >
            <span className="flex flex-col items-center leading-tight">
              <span>{LABEL[u.role] ?? u.role}</span>
              <span className="max-w-full truncate text-caption font-normal text-label-2">
                {u.name.split(" ")[0]}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}
