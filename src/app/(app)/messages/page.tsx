import { Inbox, MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { getOutboxCount } from "@/features/messaging/api";
import { BulkSendButton } from "@/features/messaging/components/BulkSendButton";
import { NewMessageButton } from "@/features/messaging/components/NewMessageButton";
import { channelLabel } from "@/features/messaging/labels";
import { listThreads } from "@/features/messaging/queries";
import { requireUser } from "@/lib/auth/current";
import { formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SearchField } from "@/ui/components/SearchField";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Messages" };

// Conversations (SPEC M12): one thread per customer across every channel, newest
// first. Techs see their own customers; the office sees everyone.
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const user = await requireUser("messages.send");
  const sp = await searchParams;
  const filter = sp.filter === "waiting" ? "waiting" : "all";
  const [threads, outbox] = await Promise.all([
    listThreads({ q: sp.q, filter }),
    getOutboxCount(user.id, "mine"),
  ]);
  const now = Date.now();
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Messages"
        trailing={
          <>
            <NewMessageButton />
            <HeaderActions create={false} />
          </>
        }
        search={
          <SearchField
            param="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search name or number"
          />
        }
      />
      <Page>
        <ListGroup>
          <ListSection>
            <ListRow
              icon={<Inbox aria-hidden size={18} />}
              iconTone="accent"
              title="Outbox"
              subtitle={
                outbox > 0
                  ? "Texts waiting for you to tap Send"
                  : "Nothing waiting"
              }
              badge={outbox || undefined}
              href="/messages/outbox"
            />
          </ListSection>

          <div className="flex items-center justify-between gap-2 px-1">
            <ChipRow label="Filter conversations">
              <Chip href="/messages" selected={filter === "all"} replace>
                All
              </Chip>
              <Chip
                href="/messages?filter=waiting"
                selected={filter === "waiting"}
                replace
              >
                Needs attention
              </Chip>
            </ChipRow>
            {user.perms.has("messages.bulk_send") && <BulkSendButton />}
          </div>

          {threads.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare aria-hidden size={44} />}
              title={sp.q ? "No matches" : "No conversations yet"}
              message={
                sp.q
                  ? "Try a different name or number."
                  : "Texts and emails to customers show up here, grouped by customer."
              }
              action={sp.q ? undefined : <NewMessageButton variant="button" />}
            />
          ) : (
            <ListSection header="Conversations">
              {threads.map((t) => (
                <ListRow
                  key={t.customerId}
                  leading={<Avatar name={t.name} size={40} />}
                  title={t.name}
                  subtitle={
                    t.lastBody
                      ? `${t.lastDirection === "out" ? "You: " : ""}${t.lastBody}`
                      : t.pending
                        ? "Text waiting in the outbox"
                        : channelLabel(t.lastChannel)
                  }
                  detail={formatRelative(t.lastAt, now)}
                  badge={t.pending || undefined}
                  href={`/messages/${t.customerId}`}
                />
              ))}
            </ListSection>
          )}
        </ListGroup>
      </Page>
    </PageTransition>
  );
}
