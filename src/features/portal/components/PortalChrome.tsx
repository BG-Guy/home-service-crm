import { LinkIcon } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";
import { EmptyState } from "@/ui/components/EmptyState";

// Shared pieces of the customer pages (SPEC M23): the "link expired" state and the
// footer (license #, phone, "Pay only {Company}").

export async function PortalExpired({ what = "link" }: { what?: string }) {
  const company = await findCompany();
  return (
    <div className="list-card mt-4">
      <EmptyState
        icon={<LinkIcon size={44} strokeWidth={1.6} />}
        title={`This ${what} has expired`}
        message={
          company?.phone
            ? `For your security, links stop working after a while. Call or text ${formatPhoneDisplay(company.phone)} and we'll send a fresh one.`
            : "For your security, links stop working after a while. Contact us and we'll send a fresh one."
        }
      />
    </div>
  );
}

export async function PortalFooter() {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const name = settings.branding.app_name || company?.name || "us";
  const licenses = settings.company.license_numbers.map(
    (l) => `${l.state} ${l.trade} #${l.number}`,
  );
  return (
    <footer className="mt-10 space-y-1 border-t border-sep pt-4 text-center text-footnote text-label-2 print:hidden">
      <p className="font-semibold text-label">
        Pay only {name}. Never pay a technician personally.
      </p>
      {company?.phone ? (
        <p>
          Questions?{" "}
          <a href={`tel:${company.phone}`} className="text-accent-text">
            {formatPhoneDisplay(company.phone)}
          </a>
          {company.email ? (
            <>
              {" · "}
              <a href={`mailto:${company.email}`} className="text-accent-text">
                {company.email}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {licenses.length > 0 ? <p>Licensed: {licenses.join(" · ")}</p> : null}
      {company?.legalName ? <p>{company.legalName}</p> : null}
    </footer>
  );
}
