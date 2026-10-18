import type { ReactNode } from "react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";

// Customer-facing pages (SPEC M23 magic links, lead forms, policies): no login,
// no app chrome — a simple branded column. Owners render their own content.
export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const name = settings.branding.app_name || company?.name || "";
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {name && (
        <header
          data-chrome
          className="mx-auto w-full max-w-[640px] px-[var(--gutter)] pb-2 pt-[calc(env(safe-area-inset-top)+20px)]"
        >
          <div className="text-headline">{name}</div>
          {company?.phone && (
            <a
              href={`tel:${company.phone}`}
              className="text-subhead text-accent-text"
            >
              {formatPhoneDisplay(company.phone)}
            </a>
          )}
        </header>
      )}
      <main
        id="main"
        className="mx-auto w-full max-w-[640px] flex-1 px-[var(--gutter)] pb-[max(env(safe-area-inset-bottom),32px)] pt-2"
      >
        {children}
      </main>
    </div>
  );
}
