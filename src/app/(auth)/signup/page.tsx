import { Building } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { findCompany, getSettings } from "@/lib/settings";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { AuthCard } from "../_components/AuthCard";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Get started" };

// First run (SPEC M01, §3.3): with no company yet, signup creates the company and
// the first admin. Afterwards it's invite-only, unless settings.auth.open_signup —
// then new accounts land as `pending` until an admin approves them.
export default async function SignupPage() {
  const [company, settings, user] = await Promise.all([
    findCompany(),
    getSettings(),
    getCurrentUser(),
  ]);
  if (user) redirect("/");

  if (!company) {
    return (
      <AuthCard
        title="Set up your business"
        subtitle="Create your workspace and admin account. It takes about a minute."
      >
        <SignupForm mode="company" />
      </AuthCard>
    );
  }

  if (!settings.auth.open_signup) {
    return (
      <AuthCard title={company.name}>
        <div className="list-card">
          <EmptyState
            compact
            icon={<Building size={44} />}
            title="Invite only"
            message="This workspace is invite-only. Ask your admin to send you an invite link."
            action={
              <Button href="/login" variant="tinted">
                Sign in
              </Button>
            }
          />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Request an account"
      subtitle={`Join ${company.name}. An admin approves new accounts.`}
      footer={
        <a href="/login" className="text-accent-text">
          Already have an account? Sign in
        </a>
      }
    >
      <SignupForm mode="join" companyName={company.name} />
    </AuthCard>
  );
}
