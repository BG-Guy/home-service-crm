import type { ReactNode } from "react";
import { BrandMark } from "@/app/_components/BrandMark";

/**
 * Header + body for every auth screen: the app glyph, a large title, a subtitle,
 * then the form (or message) and an optional footer link line.
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
      <div className="mb-7 flex flex-col items-center text-center">
        <BrandMark size={64} className="mb-5" />
        <h1 className="text-large-title tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-[34ch] text-body text-label-2">
            {subtitle}
          </p>
        )}
      </div>
      {children}
      {footer && (
        <div className="mt-6 text-center text-subhead text-label-2">
          {footer}
        </div>
      )}
    </div>
  );
}
