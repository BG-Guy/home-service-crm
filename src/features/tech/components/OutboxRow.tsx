import "server-only";
import { Inbox } from "lucide-react";
import { getOutboxCount } from "@/features/messaging/api";
import type { SessionUser } from "@/lib/types";
import { ListRow } from "@/ui/components/List";

/**
 * The tech's outbox (link-mode texts waiting for a tap) as one list row. Reads the
 * count through the messaging API so the tech pages don't pull the messaging slot
 * module's client code (composer, consent sheets) into their JS.
 */
export async function OutboxRow({ user }: { user: SessionUser }) {
  if (!user.perms.has("messages.send")) return null;
  const n = await getOutboxCount(user.id, "mine").catch(() => 0);
  return (
    <ListRow
      href="/messages/outbox"
      icon={<Inbox size={17} aria-hidden />}
      iconTone="blue"
      title="Outbox"
      subtitle={n > 0 ? "Texts waiting for a tap to send" : undefined}
      detail={n > 0 ? undefined : "All sent"}
      accessory={n > 0 ? "badge" : "chevron"}
      badge={n}
      badgeCritical={n > 0}
    />
  );
}
