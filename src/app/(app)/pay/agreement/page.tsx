import { FileSignature } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { signCompAgreement } from "@/features/payroll/actions";
import { Trace } from "@/features/payroll/components/Trace";
import { agreementFor } from "@/features/payroll/server/agreement";
import { getLatestSignature } from "@/features/signatures/api";
import { SignatureSheet } from "@/features/signatures/slots.client";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Pay agreement" };

/** Compensation agreement (SPEC M16, ⚖️ CA Labor Code 2751): plan in plain words + two worked examples, e-signed. */
export default async function AgreementPage() {
  const user = await requireUser("payroll.view_own");
  if (!(await isEnabled("payroll"))) notFound();
  const [st, tz] = await Promise.all([
    agreementFor(user.id),
    getCompanyTimezone(),
  ]);
  if (!st)
    return (
      <PageTransition>
        <NavBar title="Pay agreement" back={{ href: "/pay", label: "Pay" }} />
        <Page className="pt-4">
          <div className="list-card">
            <EmptyState
              icon={<FileSignature size={44} strokeWidth={1.5} />}
              title="No pay plan yet"
              message="Your admin assigns your pay plan. You'll sign it here."
            />
          </div>
        </Page>
      </PageTransition>
    );
  const sig = st.techCompId
    ? await getLatestSignature("comp_agreement", st.techCompId)
    : null;
  const doc = st.doc;
  return (
    <PageTransition>
      <NavBar title="Pay agreement" back={{ href: "/pay", label: "Pay" }} />
      <Page className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          {st.required ? (
            <Banner
              tone="legal"
              title={
                st.signedVersion
                  ? `Your plan changed (v${st.signedVersion} → v${st.planVersion})`
                  : "Please review and sign"
              }
            >
              Read how you&apos;re paid, check the examples, then sign at the
              bottom. You get a signed copy.
            </Banner>
          ) : (
            sig && (
              <Banner tone="success" title={`Signed v${st.signedVersion}`}>
                Signed by {sig.signerName} on {formatDateTime(sig.signedAt, tz)}
                . Fingerprint {sig.docSha256.slice(0, 12)}…
              </Banner>
            )
          )}
          <header className="px-4">
            <h2 className="text-title2 font-semibold">{doc.title}</h2>
            <p className="text-subhead text-label-2">
              Plan {st.planKey} · version {st.planVersion}
            </p>
          </header>
          {doc.sections.map((sec) => (
            <ListSection key={sec.heading} header={sec.heading}>
              <ul className="flex list-disc flex-col gap-2 py-3 pl-9 pr-4 text-body">
                {sec.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </ListSection>
          ))}
          {doc.examples.map((ex) => (
            <ListSection
              key={ex.title}
              header={ex.title}
              footer={ex.description}
            >
              <div className="px-4 py-2">
                <Trace steps={ex.steps} />
              </div>
            </ListSection>
          ))}
          {st.required && (
            <div className="px-4 pb-6">
              <SignatureSheet
                title="Sign your pay agreement"
                docType="comp_agreement"
                consentText="I agree to sign this compensation agreement electronically and to receive a copy electronically."
                summaryLines={[`${doc.title}`, `Version ${st.planVersion}`]}
                signerNameDefault={user.name}
                action={signCompAgreement}
                triggerLabel="Sign agreement"
                fullWidth
              />
            </div>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
