import { Phone } from "lucide-react";
import type { ReactNode } from "react";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";

// Customer-facing pages (SPEC M23 magic links, lead forms, policies): no login,
// no app chrome — a calm branded column (DESIGN.md §7 brief 8). The header is the
// business's monogram, name and a round call button. Server-only, zero JS.
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
          className="mx-auto flex w-full max-w-[640px] items-center gap-3 px-[var(--gutter)] pb-3 pt-[calc(env(safe-area-inset-top)+16px)]"
        >
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-fill text-headline text-on-accent"
          >
            {name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-headline">{name}</div>
            {company?.phone && (
              <div className="num truncate text-footnote text-label-2">
                {formatPhoneDisplay(company.phone)}
              </div>
            )}
          </div>
          {company?.phone && (
            <a
              href={`tel:${company.phone}`}
              aria-label={`Call ${name}`}
              className="pressable inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-accent-text shadow-card"
            >
              <Phone size={18} aria-hidden />
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
