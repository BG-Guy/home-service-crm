import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerCard } from "@/features/customers/slots";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import {
  LogReplyButton,
  OptoutReviewBanner,
} from "@/features/messaging/components/ThreadActions";
import { ThreadMessages } from "@/features/messaging/components/ThreadMessages";
import { getComposerData, getThread } from "@/features/messaging/queries";
import { MessageComposer } from "@/features/messaging/slots.client";
import { requireUser } from "@/lib/auth/current";
import { isUuid } from "@/lib/ids";
import { getCompany } from "@/lib/settings";
import { safeTimeZone } from "@/lib/time";
import { Banner } from "@/ui/components/Banner";

export const metadata: Metadata = { title: "Conversation" };

// One customer's conversation (SPEC M12): bubbles for all channels, upcoming sends,
// the composer and "log received reply" (link mode has no inbound driver).
export default async function MessagesCustomerIdPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const user = await requireUser("messages.send");
  const { customerId } = await params;
  if (!isUuid(customerId)) notFound();
  const thread = await getThread(customerId);
  const [composer, company] = await Promise.all([
    getComposerData(customerId, user),
    getCompany(),
  ]);
  const tz = safeTimeZone(company.timezone);
  return (
    <PushedScreen
      title={thread.customer.name}
      back={
        // Techs reach threads from their Inbox tab (/messages/outbox).
        user.baseRole === "tech"
          ? { href: "/messages/outbox", label: "Inbox" }
          : { href: "/messages", label: "Messages" }
      }
      trailing={
        thread.canLogReply ? <LogReplyButton customerId={customerId} /> : null
      }
    >
      <div className="flex flex-col gap-4">
        <CustomerCard customerId={customerId} variant="compact" />
        {thread.optoutFlag && <OptoutReviewBanner customerId={customerId} />}
        {thread.customer.smsStatus === "opted_out" && (
          <Banner tone="info" title="Opted out of texts">
            Automated texts are off for this customer. Email still works.
          </Banner>
        )}
        {thread.masked && (
          <p className="px-1 text-footnote text-label-2">
            Addresses, numbers and links in these messages show from 2 h before
            your visit.
          </p>
        )}
        <ThreadMessages items={thread.messages} tz={tz} />
        <section
          aria-label="Write a message"
          className="sticky bottom-[calc(var(--tabbar-h,0px)+env(safe-area-inset-bottom))] z-10 -mx-[var(--gutter)] border-t-[0.5px] border-sep bg-bar px-[var(--gutter)] pt-3 pb-3 backdrop-blur-xl lg:static lg:mx-0 lg:rounded-card lg:border-0 lg:bg-card lg:p-4 lg:shadow-card"
        >
          <MessageComposer customerId={customerId} initial={composer} compact />
        </section>
      </div>
    </PushedScreen>
  );
}
