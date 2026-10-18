"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";

/** Monospace value or code snippet with a Copy button (≥ 44 px target). */
export function CopyBlock({
  value,
  label,
  code = false,
  className,
}: {
  value: string;
  label?: string;
  code?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select the text and copy it manually.");
    }
  };
  return (
    <div className={cx("relative rounded-control bg-fill-2", className)}>
      {label && (
        <div className="px-3 pt-2 text-caption font-semibold uppercase text-label-2">
          {label}
        </div>
      )}
      <pre
        className={cx(
          "overflow-x-auto px-3 py-2.5 pr-14 font-mono text-[12.5px] leading-[18px]",
          code ? "max-h-96 whitespace-pre" : "whitespace-pre-wrap break-all",
        )}
      >
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy${label ? ` ${label}` : ""}`}
        className="pressable absolute right-1 top-1 flex size-11 items-center justify-center rounded-full text-accent-text hover:bg-fill"
      >
        {copied ? (
          <Check size={18} aria-hidden />
        ) : (
          <Copy size={18} aria-hidden />
        )}
      </button>
    </div>
  );
}
