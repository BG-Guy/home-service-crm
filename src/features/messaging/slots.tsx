import "server-only";
import { Inbox, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getCustomerBrief } from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompany } from "@/lib/settings";
import { formatDate, safeTimeZone } from "@/lib/time";
import { Badge } from "@/ui/components/Badge";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { getOutboxCount } from "./api";
import {
  ConsentActions,
  LogReplyButton,
  MessageComposer,
} from "./components/islands";
import { ThreadMessages } from "./components/ThreadMessages";
import type {
  ConsentPanelProps,
  JobMessagesPanelProps,
  OutboxCountBadgeProps,
} from "./contracts";
import { getComposerData, getConsentLedger, getJobThread } from "./queries";

// Server UI slots produced by B5 (BUILD_PLAN §5.1). Each takes ids, calls
// getCurrentUser() itself and returns null when the viewer may not see it.

const SMS_STATUS: Record<
  string,
  { label: string; tone: "green" | "blue" | "red" | "gray" }
> = {
  marketing: { label: "Texts + offers", tone: "green" },
  transactional: { label: "Appointment texts", tone: "blue" },
  opted_out: { label: "Opted out", tone: "red" },
  unknown: { label: "No consent yet", tone: "gray" },
};

/** S30 — Job thread, scheduled sends and composer. */
export async function JobMessagesPanel({ jobId }: JobMessagesPanelProps) {
  const user = await getCurrentUser();
  if (!user?.perms.has("messages.send")) return null;
  let customerId: string;
  try {
    const job = await assertJobAccess(user, jobId, "read");
    customerId = job.customerId;
  } catch {
    return null;
  }
  const [items, composer, company] = await Promise.all([
    getJobThread(jobId, user),
    getComposerData(customerId, user, { jobId }),
    getCompany(),
  ]);
  const tz = safeTimeZone(company.timezone);
  return (
    <section aria-label="Job messages" className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-title3 text-label">Messages</h2>
        <div className="flex items-center gap-2">
          <LogReplyButton customerId={customerId} jobId={jobId} />
          <Link
            href={`/messages/${customerId}`}
            className="text-subhead text-accent-text"
          >
            Full conversation
          </Link>
        </div>
      </div>
      <ThreadMessages
        items={items}
        tz={tz}
        showJobLinks={false}
        emptyHint="Texts and emails about this job show up here."
      />
      {composer && (
        <div className="rounded-card bg-card p-4 shadow-card">
          <MessageComposer
            customerId={customerId}
            jobId={jobId}
            initial={composer}
            compact
          />
        </div>
      )}
    </section>
  );
}

/** S31 — SMS status, consent ledger and stop-texting action. */
export async function ConsentPanel({ customerId }: ConsentPanelProps) {
  const user = await getCurrentUser();
  if (!user?.perms.has("messages.send")) return null;
  const brief = await getCustomerBrief(customerId, user).catch(() => null);
  if (!brief) return null;
  const [ledger, company] = await Promise.all([
    getConsentLedger(customerId),
    getCompany(),
  ]);
  const tz = safeTimeZone(company.timezone);
  const st = SMS_STATUS[brief.smsStatus] ?? SMS_STATUS.unknown;
  const optedOut = brief.smsStatus === "opted_out";
  return (
    <ListSection
      header="Messaging consent"
      footer="Consent is an append-only log: every change keeps who, when and how."
    >
      <ListRow
        icon={<ShieldCheck aria-hidden size={18} />}
        iconTone={st?.tone === "red" ? "red" : "green"}
        title="Text messages"
        detail={
          <Pill tone={st?.tone ?? "gray"} size="sm">
            {st?.label}
          </Pill>
        }
      />
      {(brief.flags.doNotText || brief.flags.doNotContact) && (
        <ListRow
          title={brief.flags.doNotContact ? "Do not contact" : "Do not text"}
          subtitle="Set on the customer's flags"
          destructive
        />
      )}
      {ledger.slice(0, 8).map((e) => (
        <ListRow
          key={e.id}
          title={`${e.channel === "email" ? "Email" : "Text"} ${e.purpose} ${e.action === "grant" ? "allowed" : "withdrawn"}`}
          subtitle={`${e.source.replace(/_/g, " ")}${e.by ? ` · ${e.by}` : ""}`}
          detail={formatDate(e.at, tz)}
        />
      ))}
      <div className="px-4 py-3">
        <ConsentActions
          customerId={customerId}
          optedOut={optedOut}
          canGrant={user.perms.has("customers.edit")}
        />
      </div>
    </ListSection>
  );
}

/** S32 — "Outbox (n)" link to /messages/outbox. */
export async function OutboxCountBadge({
  scope = "mine",
}: OutboxCountBadgeProps) {
  const user = await getCurrentUser();
  if (!user?.perms.has("messages.send")) return null;
  const s =
    scope === "all" && user.perms.has("messages.outbox_all") ? "all" : "mine";
  const n = await getOutboxCount(user.id, s);
  return (
    <Link
      href={s === "all" ? "/messages/outbox?scope=all" : "/messages/outbox"}
      className="flex min-h-11 items-center gap-3 rounded-card bg-card px-4 py-2.5 shadow-card"
    >
      <span className="flex size-[29px] items-center justify-center rounded-[7px] bg-accent-fill text-on-accent">
        <Inbox aria-hidden size={18} />
      </span>
      <span className="flex-1 text-body text-label">Outbox</span>
      {n > 0 ? (
        <Badge count={n} label={`${n} texts waiting`} />
      ) : (
        <span className="text-subhead text-label-2">All sent</span>
      )}
    </Link>
  );
}
