import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { listDemoLogins } from "@/lib/auth/demo-logins";
import { safeNextPath } from "@/lib/auth/safe-next";
import { findCompany, getSettings } from "@/lib/settings";
import { AuthCard } from "../_components/AuthCard";
import { DemoLogins } from "./DemoLogins";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

/** Only same-site relative paths survive as the post-login destination. */
function safeNext(v: string | string[] | undefined): string {
  return safeNextPath(v) ?? "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [company, settings, user, sp, demo] = await Promise.all([
    findCompany(),
    getSettings(),
    getCurrentUser(),
    searchParams,
    listDemoLogins(),
  ]);
  // First run: nothing to sign in to yet.
  if (!company) redirect("/signup");
  const next = safeNext(sp.next);
  if (user) redirect(next || "/");

  return (
    <AuthCard
      title="Sign in"
      subtitle={company.name}
      footer={
        <>
          New to the team? Open the invite link your admin sent you.
          {settings.auth.open_signup && (
            <>
              <br />
              <Link href="/signup" className="text-accent-text">
                Request an account
              </Link>
            </>
          )}
        </>
      }
    >
      {demo.length > 0 && (
        <div className="mb-5">
          <DemoLogins
            users={demo.map((u) => ({ role: u.role, name: u.name }))}
          />
        </div>
      )}
      <LoginForm next={next} />
    </AuthCard>
  );
}
