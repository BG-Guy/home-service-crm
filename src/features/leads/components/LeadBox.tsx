"use client";

import {
  Ban,
  Briefcase,
  CalendarDays,
  Maximize2,
  MessageSquare,
  Navigation,
  Phone,
  Repeat,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { SwipeActions } from "@/ui/components/SwipeActions";
import { cx } from "@/ui/cx";
import type { LeadBoxData } from "../contracts";
import { lostReasonLabel } from "../labels";
import { isOpenStatus } from "../rules";
import { LeadCallButton } from "./LeadCallButton";
import { useLeadCardMaybe, useLeadEnv } from "./lead-env";
import {
  directionsHref,
  textHref,
  useIsApple,
  useNow,
  waitLabel,
} from "./lead-links";
import { RoundAction } from "./RoundAction";
import { SlaAvatar } from "./SlaAvatar";
import { useLeadChanges } from "./use-lead-changes";

// "Lost" from the swipe opens a sheet: its own chunk, loaded on first use.
const LostSheet = dynamic(
  () => import("./LostSheet").then((m) => m.LostSheet),
  { ssr: false },
);

/**
 * The box's second line: what they want and where the lead stands. Tight boxes
 * show an unanswered lead's wait under the ring instead (`wide` = 1 column).
 */
function statusLine(
  l: LeadBoxData,
  now: number | null,
  wide: boolean,
): ReactNode {
  const service = l.serviceName?.trim() || "Service not given";
  if (l.flags.check)
    return (
      <>
        <span className="font-semibold text-warning">Check</span> · {service}
      </>
    );
  switch (l.status) {
    case "new":
      if (l.respondedAt) return `${service} · answered`;
      return now && wide
        ? `${service} · ${waitLabel(now - Date.parse(l.slaStart))}`
        : service;
    case "contacted":
    case "qualified":
      return `${service} · ${l.status}`;
    case "lost":
      return `Lost${l.lostReason ? ` · ${lostReasonLabel(l.lostReason).toLowerCase()}` : ""}`;
    case "spam":
      return "Spam";
    case "booked":
      if (l.job?.cancelled) return "Booked · job cancelled";
      if (l.when?.kind !== "arrival") return "Booked";
      // Tight boxes: just the arrival ("Fri 10–12"); the chip says Booked.
      return wide ? `Booked · ${l.when.label}` : l.when.short;
    default:
      return service;
  }
}

/**
 * One lead box (contract 3.4): name, job type, street and the wait, with the next
 * actions on the box. Open leads: Call, Text, Directions and Open card; "Check"
 * leads: Looks legit and Spam; closed leads keep their way back (Reopen, Not
 * spam, Open job). Tapping the box opens the lead card. Swipe left on an open
 * lead for Lost / Spam (each with Undo).
 */
export function LeadBox({
  lead,
  layout,
  selected,
  onOpen,
}: {
  lead: LeadBoxData;
  layout: "grid1" | "grid2" | "drawer";
  selected?: boolean;
  onOpen(id: string): void;
}) {
  const env = useLeadEnv();
  const card = useLeadCardMaybe();
  const now = useNow();
  const apple = useIsApple();
  const changes = useLeadChanges();
  const [lostOpen, setLostOpenState] = useState(false);
  const [lostArmed, setLostArmed] = useState(false);
  const setLostOpen = (v: boolean) => {
    if (v) setLostArmed(true);
    setLostOpenState(v);
  };
  const open = isOpenStatus(lead.status);
  const wide = layout === "grid1";
  const canEdit = env.can.edit;
  const text = textHref(lead);
  const nav = directionsHref(lead, apple);
  // Warm the card on press, or after a short hover (not on every mouse pass:
  // each warm-up is a server action, and those run one at a time).
  const warm = () => card?.prefetch(lead.id);
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = wide ? lead.name : lead.shortName;

  // ---- the action row
  let actions: ReactNode;
  if (open && !lead.flags.check) {
    const call = (onClick?: () => void, busy?: boolean) =>
      wide ? (
        <RoundAction
          icon={<Phone />}
          label="Call"
          tone="primary"
          size={44}
          onClick={onClick}
          busy={busy}
          disabled={!onClick}
        />
      ) : (
        <IconButton
          label={`Call ${lead.name}`}
          variant="primary"
          size={36}
          onClick={onClick}
          disabled={!onClick || busy}
        >
          <Phone size={17} />
        </IconButton>
      );
    actions = (
      <>
        {lead.phoneE164 && canEdit ? (
          <LeadCallButton
            leadId={lead.id}
            name={lead.name}
            render={({ onClick, busy }) => call(onClick, busy)}
          />
        ) : (
          call()
        )}
        {wide ? (
          <>
            <RoundAction
              icon={<MessageSquare />}
              label="Text"
              size={44}
              href={text}
              external={!lead.customerId}
              disabled={!text}
            />
            <RoundAction
              icon={<Navigation />}
              label="Directions"
              size={44}
              href={nav}
              external
              newTab
              disabled={!nav}
            />
            <RoundAction
              icon={<Maximize2 />}
              label="Open"
              tone="tinted"
              size={44}
              ariaLabel={`Open the card for ${lead.name}`}
              onClick={() => onOpen(lead.id)}
            />
          </>
        ) : (
          <>
            {text ? (
              <IconButton
                label={`Text ${lead.name}`}
                variant="secondary"
                size={36}
                href={text}
                transition={lead.customerId ? "push" : "none"}
              >
                <MessageSquare size={17} />
              </IconButton>
            ) : (
              <IconButton
                label="No phone"
                variant="secondary"
                size={36}
                disabled
              >
                <MessageSquare size={17} />
              </IconButton>
            )}
            {nav ? (
              <IconButton
                label={`Directions to ${lead.street ?? "the address"}`}
                variant="secondary"
                size={36}
                href={nav}
                external
              >
                <Navigation size={17} />
              </IconButton>
            ) : (
              <IconButton
                label="No address"
                variant="secondary"
                size={36}
                disabled
              >
                <Navigation size={17} />
              </IconButton>
            )}
            <IconButton
              label={`Open the card for ${lead.name}`}
              variant="tinted"
              size={36}
              onClick={() => onOpen(lead.id)}
            >
              <Maximize2 size={17} />
            </IconButton>
          </>
        )}
      </>
    );
  } else {
    // Check leads, and closed leads with their way back.
    const way: ReactNode = !canEdit ? null : lead.flags.check ? (
      <>
        <Button
          variant="secondary"
          size="sm"
          icon={wide ? <ShieldCheck size={16} aria-hidden /> : undefined}
          loading={changes.busy === "legit"}
          onClick={() => changes.notSpam(lead.id, true)}
          className={cx(!wide && "min-w-0 flex-1 px-3")}
        >
          Looks legit
        </Button>
        {wide ? (
          <Button
            variant="secondary"
            destructive
            size="sm"
            icon={<Ban size={16} aria-hidden />}
            loading={changes.busy === "spam"}
            onClick={() => changes.spam(lead.id)}
          >
            Spam
          </Button>
        ) : (
          <IconButton
            label="Mark as spam"
            variant="secondary"
            destructive
            size={36}
            onClick={() => changes.spam(lead.id)}
          >
            <Ban size={16} />
          </IconButton>
        )}
      </>
    ) : lead.status === "lost" ||
      (lead.status === "booked" && lead.job?.cancelled) ? (
      <Button
        variant="secondary"
        size="sm"
        icon={<RotateCcw size={16} aria-hidden />}
        loading={changes.busy === "reopen"}
        onClick={() => changes.reopen(lead.id)}
      >
        Reopen
      </Button>
    ) : lead.status === "spam" ? (
      <Button
        variant="secondary"
        size="sm"
        icon={<ShieldCheck size={16} aria-hidden />}
        loading={changes.busy === "not_spam"}
        onClick={() => changes.notSpam(lead.id, false)}
      >
        Not spam
      </Button>
    ) : null;
    const job =
      lead.status === "booked" && lead.job && !lead.job.cancelled ? (
        <Button
          variant="primary"
          size="sm"
          href={`/jobs/${lead.job.id}`}
          transition="push"
          icon={<Briefcase size={16} aria-hidden />}
        >
          Open job
        </Button>
      ) : null;
    actions = (
      <>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {job ?? way}
        </div>
        {(wide || !lead.flags.check) && (
          <IconButton
            label={`Open the card for ${lead.name}`}
            variant="tinted"
            size={36}
            onClick={() => onOpen(lead.id)}
          >
            <Maximize2 size={16} />
          </IconButton>
        )}
      </>
    );
  }

  const body = (
    <article
      aria-label={`Lead ${lead.name}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") hover.current = setTimeout(warm, 250);
      }}
      onPointerLeave={() => clearTimeout(hover.current)}
      onPointerDown={warm}
      className={cx(
        "relative flex h-full flex-col rounded-card bg-card shadow-card",
        "hover-lift transition-shadow",
        wide ? "gap-3.5 p-4" : "gap-2.5 p-2.5 pt-3",
        selected && "ring-2 ring-accent",
      )}
    >
      <div className={cx("flex items-start", wide ? "gap-3" : "gap-2")}>
        <SlaAvatar
          initials={lead.initials}
          seed={lead.customerId ?? lead.id}
          size={wide ? 46 : 38}
          slaStart={lead.slaStart}
          respondedAt={lead.respondedAt}
          ring={open}
          waitTag={!wide && lead.status === "new"}
          muted={!open && lead.status !== "booked"}
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpen(lead.id)}
              className={cx(
                "box-hit min-w-0 truncate text-left font-semibold text-label outline-none",
                wide ? "text-headline" : "text-[16px] leading-[21px]",
              )}
            >
              {name}
            </button>
            {lead.flags.returning && (
              <Repeat
                size={13}
                className="shrink-0 text-accent-text"
                aria-label="Returning customer"
              />
            )}
            {lead.flags.test && (
              <span className="shrink-0 rounded-pill bg-fill px-1.5 text-caption text-label-2">
                Test
              </span>
            )}
          </h3>
          <p
            className={cx(
              "num truncate text-label-2",
              wide ? "text-subhead" : "text-footnote",
            )}
          >
            {statusLine(lead, now, wide)}
          </p>
          <p
            className={cx(
              "truncate text-label-2",
              wide ? "text-subhead" : "text-footnote",
              !lead.street && "text-label-3",
            )}
          >
            {lead.street ?? (lead.zip ? `ZIP ${lead.zip}` : "No address yet")}
            {lead.flags.outsideArea && (
              <span className="text-danger"> · outside area</span>
            )}
          </p>
          {wide && lead.when && lead.status !== "booked" && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-footnote text-label-2">
              <CalendarDays size={13} aria-hidden className="shrink-0" />
              <span className="truncate">Wants {lead.when.label}</span>
            </p>
          )}
        </div>
      </div>
      <div
        className={cx(
          "relative z-[1] mt-auto flex items-center",
          open && !lead.flags.check
            ? wide
              ? "justify-around"
              : "justify-between"
            : "gap-2",
        )}
      >
        {actions}
      </div>
    </article>
  );

  if (!open || !canEdit) return body;
  return (
    <>
      <SwipeActions
        className="h-full rounded-card"
        trailing={[
          { label: "Lost", tone: "gray", onAction: () => setLostOpen(true) },
          {
            label: "Spam",
            destructive: true,
            onAction: () => void changes.spam(lead.id),
          },
        ]}
      >
        {body}
      </SwipeActions>
      {lostArmed && (
        <LostSheet
          leadId={lead.id}
          reasons={env.lostReasons}
          open={lostOpen}
          onOpenChange={setLostOpen}
        />
      )}
    </>
  );
}
