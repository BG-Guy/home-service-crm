import { LinkIcon } from "lucide-react";
import type { Metadata } from "next";
import { getInviteByToken } from "@/lib/auth/flows";
import { getCurrentPolicy } from "@/lib/policies";
import { EmptyState } from "@/ui/components/EmptyState";
import { AuthCard } from "../../_components/AuthCard";
import { AcceptInviteForm } from "./AcceptInviteForm";

export const metadata: Metadata = {
  title: "Accept invite",
  referrer: "no-referrer",
};

const ROLE_LABEL = {
  admin: "an admin",
  office: "office staff",
  tech: "a technician",
};

function policyText(body: string | undefined, company: string): string {
  return (body ?? "").replaceAll("{company}", company || "The company");
}

// Invite acceptance (SPEC M01): set a password, accept the e-records consent and,
// for technicians, the location monitoring notice (⚖️).
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await getInviteByToken(token);
  if (!invite) {
    return (
      <AuthCard title="Invite expired">
        <div className="list-card">
          <EmptyState
            compact
            icon={<LinkIcon size={44} />}
            title="This invite link can't be used"
            message="It may have expired (invites last 7 days) or already been accepted. Ask your admin for a new invite."
          />
        </div>
      </AuthCard>
    );
  }
  const [esign, monitoring] = await Promise.all([
    getCurrentPolicy("esign_consent"),
    invite.baseRole === "tech"
      ? getCurrentPolicy("monitoring_notice")
      : Promise.resolve(null),
  ]);
  return (
    <AuthCard
      title={`Join ${invite.companyName || "the team"}`}
      subtitle={`You've been invited as ${ROLE_LABEL[invite.baseRole]}. Set a password to finish.`}
    >
      <AcceptInviteForm
        token={token}
        invite={{
          name: invite.name,
          email: invite.email,
          phone: invite.phone,
          baseRole: invite.baseRole,
        }}
        esign={{
          title: esign?.title ?? "Electronic records consent",
          body: policyText(esign?.body, invite.companyName),
        }}
        monitoring={
          monitoring
            ? {
                title: monitoring.title,
                body: policyText(monitoring.body, invite.companyName),
              }
            : null
        }
      />
    </AuthCard>
  );
}
