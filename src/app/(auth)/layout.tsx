import type { ReactNode } from "react";

// Auth pages (SPEC M01): a centered, single-column card on the grouped background,
// padded for the iOS safe areas. No app chrome.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-[var(--gutter)] pb-[max(env(safe-area-inset-bottom),32px)] pt-[max(env(safe-area-inset-top),32px)]">
      <main id="main" className="w-full max-w-[420px]">
        {children}
      </main>
    </div>
  );
}
