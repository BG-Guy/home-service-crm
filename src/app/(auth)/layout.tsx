import type { ReactNode } from "react";
import { BrandGlyph } from "@/app/_components/BrandMark";
import { findCompany, getSettings } from "@/lib/settings";

// Auth pages (SPEC M01, DESIGN.md §7 brief 9). Phone: one column on the canvas,
// padded for the safe areas. Desktop (≥ 1024): a split layout, the brand panel on
// an accent gradient (CSS only, no images) beside the form. No app chrome. Nothing
// here fades in from opacity 0, so the first frame paints the form (FCP / LCP).
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const name = settings.branding.app_name || company?.name || "";
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <BrandPanel name={name} />
      <div className="flex min-h-dvh flex-col items-center justify-center px-[var(--gutter)] pb-[max(env(safe-area-inset-bottom),32px)] pt-[max(env(safe-area-inset-top),40px)] lg:px-12">
        <main id="main" className="w-full max-w-[420px]">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Desktop brand panel: accent gradient with soft light blooms, the mark and the name. */
function BrandPanel({ name }: { name: string }) {
  return (
    <aside
      aria-hidden
      className="relative hidden overflow-hidden p-12 text-on-accent lg:flex lg:flex-col lg:justify-between"
      style={{
        background: [
          "radial-gradient(120% 80% at 0% 0%, rgb(255 255 255 / .22), transparent 55%)",
          "radial-gradient(90% 70% at 100% 100%, rgb(0 0 0 / .28), transparent 60%)",
          "linear-gradient(155deg, var(--accent-fill), color-mix(in oklab, var(--accent-fill) 62%, #000))",
        ].join(","),
      }}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-[11px] bg-white/18 ring-1 ring-white/25 backdrop-blur-sm">
          <BrandGlyph size={30} cut="var(--accent-fill)" />
        </span>
        {name ? (
          <span className="text-headline text-on-accent">{name}</span>
        ) : null}
      </div>
      <div className="max-w-[26ch]">
        <p className="text-[44px] font-bold leading-[1.08] tracking-[-0.03em]">
          Every job, from first call to paid.
        </p>
        <p className="mt-4 text-body text-white/80">
          Leads, the schedule, the field app, estimates, invoices and payments
          in one place.
        </p>
      </div>
      {/* Decorative rings, pure CSS */}
      <span className="pointer-events-none absolute -bottom-40 -right-40 size-[520px] rounded-full ring-1 ring-white/12" />
      <span className="pointer-events-none absolute -bottom-24 -right-24 size-[360px] rounded-full ring-1 ring-white/10" />
      <p className="relative text-footnote text-white/70">
        {name ? `${name} · ` : ""}Secure sign-in
      </p>
    </aside>
  );
}
