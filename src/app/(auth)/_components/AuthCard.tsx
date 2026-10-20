import type { ReactNode } from "react";
import { BrandMark } from "@/app/_components/BrandMark";

/**
 * Header + body for every auth screen: the app glyph (phone only; desktop shows it
 * in the brand panel), a large title, a subtitle, then the form (or message) and
 * an optional footer link line. `enter-fade-up` starts at opacity .5 and rises
 * 8 px, so the first frame already paints (no FCP / LCP gap).
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="enter-fade-up flex flex-col">
      <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <BrandMark size={60} className="mb-6 lg:hidden" />
        <h1 className="text-large-title">{title}</h1>
        {subtitle && (
          <p className="mt-2 max-w-[36ch] text-body text-label-2">{subtitle}</p>
        )}
      </div>
      {children}
      {footer && (
        <div className="mt-8 text-center text-subhead text-label-2 lg:text-left">
          {footer}
        </div>
      )}
    </div>
  );
}
