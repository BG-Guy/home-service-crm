import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { OutboxList } from "@/features/messaging/components/OutboxList";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { listOutbox, listThreads } from "@/features/messaging/queries";
import { getCurrentUser, requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import { formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return { title: user?.baseRole === "tech" ? "Inbox" : "Outbox" };
}

// Link-mode outbox (SPEC M12): each card opens Messages prefilled; coming back asks
// "Sent? Yes / Not sent / Skip". Mine, or everyone's with messages.outbox_all.
// For techs this is the Inbox TAB ROOT (messaging nav `byRole.tech`): a large title,
// no back button, texts to send plus their conversations (QA T1-24/T4-24). For the
// office it stays a screen pushed from Messages.
export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireUser("messages.send");
  const sp = await searchParams;
  const canSeeAll = user.perms.has("messages.outbox_all");
  const scope = sp.scope === "all" && canSeeAll ? "all" : "mine";
  const tabRoot = user.baseRole === "tech";
  const [cards, settings, threads] = await Promise.all([
    listOutbox(scope),
    getSettings(),
    tabRoot ? listThreads({}) : Promise.resolve([]),
  ]);
  const outbox = (
    <OutboxList
      cards={cards}
      scope={scope}
      canSeeAll={canSeeAll}
      linkDelimiter={settings.messaging.link_delimiter}
      renderedAt={Date.now()}
    />
  );

  if (!tabRoot)
    return (
      <PushedScreen
        title="Outbox"
        back={{ href: "/messages", label: "Messages" }}
      >
        {outbox}
      </PushedScreen>
    );

  const now = Date.now();
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Inbox"
        trailing={<HeaderActions create={false} />}
      />
      <Page>
        <ListGroup>
          <section aria-labelledby="inbox-outbox-h">
            <h2
              id="inbox-outbox-h"
              className="px-4 pb-1.5 text-footnote uppercase text-label-2"
            >
              Texts to send
            </h2>
            {outbox}
          </section>

          {threads.length === 0 ? (
            <EmptyState
              icon={<MessagesSquare aria-hidden size={44} />}
              title="No conversations yet"
              message="Texts with your customers show up here."
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
                        : undefined
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
