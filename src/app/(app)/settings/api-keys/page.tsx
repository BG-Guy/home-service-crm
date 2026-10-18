import type { Metadata } from "next";
import { ApiKeysManager } from "@/features/leads/components/ApiKeysManager";
import { Screen } from "@/features/leads/components/Screen";
import { listApiKeys } from "@/features/leads/queries";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "API keys" };

// Settings → API keys (BUILD_PLAN §9): scopes, shown once, revoke.
export default async function ApiKeysPage() {
  const user = await requireUser("settings.api_keys");
  const keys = await listApiKeys(user);
  return (
    <Screen
      title="API keys"
      intro="Server keys for Zapier, Make or your own backend. Website forms use a source's public site key instead (Settings → Lead sources)."
    >
      <ApiKeysManager keys={keys} />
    </Screen>
  );
}
