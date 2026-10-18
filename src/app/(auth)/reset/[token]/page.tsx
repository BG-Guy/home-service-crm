import { LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { getPasswordReset } from "@/lib/auth/flows";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { AuthCard } from "../../_components/AuthCard";
import { NewPasswordForm } from "./NewPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  referrer: "no-referrer",
};

export default async function ResetTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const reset = await getPasswordReset(token);
  if (!reset) {
    return (
      <AuthCard title="Link expired">
        <div className="list-card">
          <EmptyState
            compact
            icon={<LinkIcon size={44} />}
            title="This reset link can't be used"
            message="Reset links work once and expire after 30 minutes. Request a new one."
            action={
              <Button href="/reset" variant="tinted">
                Request new link
              </Button>
            }
          />
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="New password"
      subtitle="Choose a new password. You'll be signed out on your other devices."
    >
      <NewPasswordForm token={token} />
    </AuthCard>
  );
}
