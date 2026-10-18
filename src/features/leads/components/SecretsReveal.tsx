"use client";

import { KeyRound } from "lucide-react";
import { Banner } from "@/ui/components/Banner";
import type { IssuedSecrets } from "../contracts";
import { CopyBlock } from "./CopyBlock";

/** One-time display of freshly issued keys (only hashes are stored). */
export function SecretsReveal({ secrets }: { secrets: IssuedSecrets }) {
  const rows: [string, string][] = [];
  if (secrets.publicKey) rows.push(["Public site key", secrets.publicKey]);
  if (secrets.secretKey) rows.push(["Secret key", secrets.secretKey]);
  if (secrets.hookUrl) rows.push(["Webhook URL", secrets.hookUrl]);
  if (secrets.googleKey) rows.push(["Google lead form key", secrets.googleKey]);
  if (rows.length === 0) return null;
  const hasSecret = !!(
    secrets.secretKey ||
    secrets.hookUrl ||
    secrets.googleKey
  );
  return (
    <div className="flex flex-col gap-2">
      {hasSecret && (
        <Banner
          tone="warning"
          icon={<KeyRound size={18} />}
          title="Copy these now"
        >
          Secret keys are shown only once. If you lose one, rotate it to get a
          new one.
        </Banner>
      )}
      {rows.map(([label, value]) => (
        <CopyBlock key={label} label={label} value={value} />
      ))}
    </div>
  );
}
