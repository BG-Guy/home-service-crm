"use client";

import {
  BadgeCheck,
  Ban,
  Briefcase,
  CalendarPlus,
  Flag,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  PhoneIncoming,
  RotateCcw,
  ShieldCheck,
  Tag,
  Undo2,
  UserCheck,
  UserMinus,
  UserRoundPlus,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment, type ReactNode, useState } from "react";
import { useConfirm } from "@/ui/components/Alert";
import type { LeadBoxData, LeadCardData } from "../contracts";
import { actionGroups, type LeadActionKey, STATUS_STEPS } from "../rules";
import { LeadCallButton } from "./LeadCallButton";
import { useLeadEnv } from "./lead-env";
import { textHref } from "./lead-links";
import { RoundAction, type RoundTone } from "./RoundAction";
import { useLeadChanges } from "./use-lead-changes";

// Sheets behind the Manage / Close buttons load on first use.
const LostSheet = dynamic(
  () => import("./LostSheet").then((m) => m.LostSheet),
  { ssr: false },
);
const LeadEditSheet = dynamic(() => import("./LeadEditSheet"), { ssr: false });
const LeadTagsSheet = dynamic(() => import("./LeadTagsSheet"), { ssr: false });

type CardLead = LeadBoxData & Partial<LeadCardData>;

const ICON: Record<LeadActionKey, ReactNode> = {
  call: <Phone />,
  text: <MessageSquare />,
  email: <Mail />,
  contacted: <PhoneIncoming />,
  not_contacted: <Undo2 />,
  qualify: <BadgeCheck />,
  unqualify: <Undo2 />,
  legit: <ShieldCheck />,
  book: <CalendarPlus />,
  open_job: <Briefcase />,
  claim: <UserCheck />,
  release: <UserMinus />,
  take_over: <UserRoundPlus />,
  edit: <Pencil />,
  tags: <Tag />,
  lost: <Flag />,
  reopen: <RotateCcw />,
  spam: <Ban />,
  not_spam: <ShieldCheck />,
};

const LABEL: Record<LeadActionKey, string> = {
  call: "Call",
  text: "Text",
  email: "Email",
  contacted: STATUS_STEPS.contacted.label,
  not_contacted: STATUS_STEPS.not_contacted.label,
  qualify: STATUS_STEPS.qualify.label,
  unqualify: STATUS_STEPS.unqualify.label,
  legit: "Looks legit",
  book: "Book",
  open_job: "Open job",
  claim: "Claim",
  release: "Release",
  take_over: "Take over",
  edit: "Edit",
  tags: "Tags",
  lost: "Lost",
  reopen: "Reopen",
  spam: "Spam",
  not_spam: "Not spam",
};

/** The reverse of a step already taken: drawn "on" (ink), like a selected chip. */
const TONE: Partial<Record<LeadActionKey, RoundTone>> = {
  call: "primary",
  book: "primary",
  open_job: "primary",
  not_contacted: "on",
  unqualify: "on",
  release: "on",
  reopen: "on",
  not_spam: "on",
  lost: "danger",
  spam: "danger",
};

/**
 * The lead's actions in four visible groups, no "…" menu (leads-flow item 4):
 * Reach (Call, Text, Email), Move forward (Contacted ↔ Not contacted, Qualify ↔
 * Unqualify, Book), Manage (Claim ↔ Release / Take over, Edit, Tags) and Close
 * (Lost ↔ Reopen, Spam ↔ Not spam). Every change shows Undo.
 */
export function LeadActionGroups({ lead }: { lead: CardLead }) {
  const env = useLeadEnv();
  const changes = useLeadChanges();
  const [confirm, confirmEl] = useConfirm();
  const [sheet, setSheet] = useState<"lost" | "edit" | "tags" | null>(null);
  const [armed, setArmed] = useState<Set<string>>(new Set());
  const show = (s: "lost" | "edit" | "tags") => {
    setArmed((a) => new Set(a).add(s));
    setSheet(s);
  };
  const groups = actionGroups(
    { ...lead, check: lead.flags.check },
    { edit: env.can.edit, convert: env.can.convert },
    env.viewerId,
  );
  const reopenBlocked =
    lead.status === "booked" && lead.reopen && !lead.reopen.ok
      ? lead.reopen.reason
      : null;

  const button = (key: LeadActionKey) => {
    const tone = TONE[key] ?? "secondary";
    const common = {
      icon: ICON[key],
      label: LABEL[key],
      tone,
      busy: changes.busy === key,
    };
    switch (key) {
      case "call":
        return (
          <LeadCallButton
            leadId={lead.id}
            name={lead.name}
            render={({ onClick, busy }) => (
              <RoundAction {...common} onClick={onClick} busy={busy} />
            )}
          />
        );
      case "text": {
        const href = textHref(lead);
        return (
          <RoundAction {...common} href={href} external={!lead.customerId} />
        );
      }
      case "email":
        return (
          <RoundAction {...common} href={`mailto:${lead.email}`} external />
        );
      case "contacted":
      case "not_contacted":
      case "qualify":
      case "unqualify":
        return (
          <RoundAction
            {...common}
            onClick={() => void changes.step(lead.id, key)}
          />
        );
      case "legit":
        return (
          <RoundAction
            {...common}
            onClick={() => void changes.notSpam(lead.id, true)}
          />
        );
      case "book":
        return (
          <RoundAction
            {...common}
            href={`/leads/new/schedule?leadId=${lead.id}`}
          />
        );
      case "open_job":
        return lead.job ? (
          <RoundAction {...common} href={`/jobs/${lead.job.id}`} />
        ) : null;
      case "claim":
        return (
          <RoundAction
            {...common}
            onClick={() => void changes.claim(lead.id)}
          />
        );
      case "release":
        return (
          <RoundAction
            {...common}
            onClick={() => void changes.release(lead.id)}
          />
        );
      case "take_over":
        return (
          <RoundAction
            {...common}
            onClick={async () => {
              const who = lead.assignedName ?? "Someone";
              const ok = await confirm({
                title: "Take over this lead?",
                message: `${who} has it now. We'll let them know you took it.`,
                confirmLabel: "Take over",
              });
              if (ok) void changes.takeOver(lead.id, lead.assignedName);
            }}
          />
        );
      case "edit":
        return <RoundAction {...common} onClick={() => show("edit")} />;
      case "tags":
        return <RoundAction {...common} onClick={() => show("tags")} />;
      case "lost":
        return <RoundAction {...common} onClick={() => show("lost")} />;
      case "reopen":
        return (
          <RoundAction
            {...common}
            disabled={!!reopenBlocked}
            onClick={() => void changes.reopen(lead.id)}
          />
        );
      case "spam":
        return (
          <RoundAction {...common} onClick={() => void changes.spam(lead.id)} />
        );
      case "not_spam":
        return (
          <RoundAction
            {...common}
            onClick={() => void changes.notSpam(lead.id, false)}
          />
        );
      default:
        return null;
    }
  };

  if (groups.length === 0) return null;
  return (
    <section aria-label="Lead actions" className="grid gap-3 sm:grid-cols-2">
      {confirmEl}
      {groups.map((g) => (
        // biome-ignore lint/a11y/useSemanticElements: a labelled button group, not a form fieldset
        <div
          key={g.key}
          role="group"
          aria-labelledby={`lag-${g.key}`}
          className="rounded-card bg-card px-2 pb-3 pt-3 shadow-card"
        >
          <h3
            id={`lag-${g.key}`}
            className="px-2 pb-2 text-footnote font-semibold text-label-2"
          >
            {g.label}
          </h3>
          <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {g.actions.map((k) => (
              <Fragment key={k}>{button(k)}</Fragment>
            ))}
          </div>
          {g.key === "close" && reopenBlocked && (
            <p className="px-2 pt-2 text-footnote text-label-2">
              {reopenBlocked}
            </p>
          )}
        </div>
      ))}
      {armed.has("lost") && (
        <LostSheet
          leadId={lead.id}
          reasons={env.lostReasons}
          open={sheet === "lost"}
          onOpenChange={(o) => setSheet(o ? "lost" : null)}
        />
      )}
      {armed.has("edit") && (
        <LeadEditSheet
          lead={lead}
          open={sheet === "edit"}
          onOpenChange={(o) => setSheet(o ? "edit" : null)}
        />
      )}
      {armed.has("tags") && (
        <LeadTagsSheet
          leadId={lead.id}
          open={sheet === "tags"}
          onOpenChange={(o) => setSheet(o ? "tags" : null)}
        />
      )}
    </section>
  );
}
