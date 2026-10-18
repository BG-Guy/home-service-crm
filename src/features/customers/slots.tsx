import "server-only";
import { sql } from "drizzle-orm";
import {
  Building2,
  ChevronRight,
  KeyRound,
  MessageCircle,
  Navigation,
  PawPrint,
  StickyNote,
  UserRound,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { execRows } from "@/db";
import { getCustomFieldDefs } from "@/features/settings/api";
import { getCurrentUser } from "@/lib/auth/current";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { Avatar } from "@/ui/components/Avatar";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { auditCustomerView, getCustomerBrief, getPropertyBrief } from "./api";
import { CallButton } from "./components/CallButton";
import { EmailLink } from "./components/EmailLink";
import { CUSTOMER_TYPE_LABEL, FlagChips, Tag } from "./components/FlagChips";
import type { CustomerCardProps, PropertyCardProps } from "./contracts";
import { navigateHref } from "./normalize";

// Server UI slots produced by B1 (BUILD_PLAN §5.1). They fetch by id, check the
// viewer's permission and row scope themselves, and return null when not visible.

/** Shown to techs outside the job's contact window (SPEC §4.2). */
const WINDOW_HINT = "Number shows from 2 h before your visit";

async function isReturning(customerId: string, jobId?: string) {
  const rows = await execRows<{ n: number }>(sql`
    select count(*)::int as n from jobs
    where customer_id = ${customerId} and status in ('completed','closed')
      ${jobId ? sql`and id <> ${jobId}` : sql``}`);
  return Number(rows[0]?.n ?? 0) > 0;
}

/** S1 — Name, type, flag chips, returning badge and balance; masked contact for techs outside the window. */
export async function CustomerCard({
  customerId,
  jobId,
  variant = "full",
  showActions = true,
}: CustomerCardProps) {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const [brief, returning] = await Promise.all([
    getCustomerBrief(customerId, viewer, { jobId }),
    isReturning(customerId, jobId).catch(() => false),
  ]);
  if (!brief) return null;
  await auditCustomerView(viewer, customerId, jobId);
  const canMessage = viewer.perms.has("messages.send");
  const phoneText = brief.contactRevealed
    ? brief.phone
      ? formatPhoneDisplay(brief.phone)
      : null
    : brief.phoneMasked;
  const canText =
    canMessage &&
    !brief.flags.doNotText &&
    !brief.flags.doNotContact &&
    brief.smsStatus !== "opted_out";
  const typeLabel = CUSTOMER_TYPE_LABEL[brief.type] ?? brief.type;
  const href = `/customers/${brief.id}`;

  if (variant === "compact") {
    return (
      <div className="list-card flex items-center gap-3 px-4 py-2.5">
        <Avatar name={brief.displayName} seed={brief.id} size={40} />
        <Link
          href={href}
          className="min-w-0 flex-1"
          transitionTypes={["nav-forward"]}
        >
          <span className="block truncate text-headline">
            {brief.displayName}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-subhead text-label-2">
            <span className="num">{phoneText ?? typeLabel}</span>
            <FlagChips flags={brief.flags} returning={returning} max={2} />
          </span>
        </Link>
        {showActions && brief.phoneMasked && brief.contactRevealed && (
          <CallButton customerId={brief.id} jobId={jobId} variant="icon" />
        )}
        {showActions && canText && (
          <Link
            href={`/messages/${brief.id}`}
            aria-label="Text"
            className="pressable flex size-9 items-center justify-center rounded-full bg-fill-2 text-label-2"
          >
            <MessageCircle size={18} />
          </Link>
        )}
      </div>
    );
  }

  if (variant === "header") {
    return (
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Avatar name={brief.displayName} seed={brief.id} size={72} />
        <div>
          <h1 className="text-title2 font-bold">{brief.displayName}</h1>
          <p className="text-subhead text-label-2">
            {typeLabel}
            {phoneText ? ` · ${phoneText}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          <FlagChips flags={brief.flags} returning={returning} />
          {brief.tags.map((t) => (
            <Tag key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
        {showActions && (
          <div className="mt-2 flex w-full max-w-md gap-2">
            {brief.phoneMasked && (
              <CallButton
                customerId={brief.id}
                jobId={jobId}
                variant="tile"
                disabled={!brief.contactRevealed}
              />
            )}
            {canText && (
              <Link
                href={`/messages/${brief.id}`}
                className="pressable flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 rounded-card bg-card text-footnote font-medium text-accent-text shadow-card"
              >
                <MessageCircle size={20} aria-hidden />
                Text
              </Link>
            )}
            {brief.email && <EmailLink customerId={brief.id} variant="tile" />}
          </div>
        )}
      </div>
    );
  }

  // full
  return (
    <ListSection
      header="Customer"
      trailing={
        <Link href={href} className="text-accent-text">
          Open
        </Link>
      }
    >
      <Link
        href={href}
        transitionTypes={["nav-forward"]}
        className="row-press flex items-center gap-3 px-4 py-3"
      >
        <Avatar name={brief.displayName} seed={brief.id} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-headline">
            {brief.displayName}
          </span>
          <span className="block truncate text-subhead text-label-2">
            {typeLabel}
            {brief.balanceCents != null && brief.balanceCents > 0 && (
              <>
                {" · Balance "}
                <MoneyText
                  cents={brief.balanceCents}
                  className="font-medium text-warning"
                />
              </>
            )}
          </span>
          {(returning ||
            Object.values(brief.flags).some(Boolean) ||
            brief.tags.length > 0) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              <FlagChips flags={brief.flags} returning={returning} />
              {brief.tags.map((t) => (
                <Tag key={t.id} name={t.name} color={t.color} />
              ))}
            </span>
          )}
        </span>
        <ChevronRight size={18} className="shrink-0 text-label-3" aria-hidden />
      </Link>
      {showActions && brief.phoneMasked ? (
        <CallButton
          customerId={brief.id}
          jobId={jobId}
          variant="row"
          label={phoneText ?? "Call"}
          subtitle={brief.contactRevealed ? "Mobile" : WINDOW_HINT}
          disabled={!brief.contactRevealed}
        />
      ) : null}
      {showActions && canText ? (
        <ListRow
          icon={<MessageCircle size={17} />}
          iconTone="blue"
          title="Text"
          subtitle={
            brief.smsStatus === "unknown"
              ? "No SMS consent on file yet"
              : undefined
          }
          href={`/messages/${brief.id}`}
        />
      ) : null}
      {showActions && brief.email ? (
        <EmailLink customerId={brief.id} variant="row" label={brief.email} />
      ) : null}
      {brief.flags.doNotService ? (
        <ListRow
          icon={<UserRound size={17} />}
          iconTone="red"
          title="Do not service"
          subtitle="Check with the office before any work."
          multiline
        />
      ) : null}
    </ListSection>
  );
}

/** S2 — Address, Navigate deep link, access notes, pets, site contact, equipment fields. */
export async function PropertyCard({
  propertyId,
  jobId,
  variant = "full",
}: PropertyCardProps) {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const p = await getPropertyBrief(propertyId, viewer, { jobId });
  if (!p) return null;
  const ua = (await headers()).get("user-agent");
  const nav = p.masked ? null : navigateHref(p, ua);
  const cityLine = `${p.city}, ${p.state} ${p.zip}`;

  if (variant === "compact") {
    return (
      <div className="list-card flex items-center gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{p.addressShort}</span>
          <span className="block truncate text-subhead text-label-2">
            {p.label ? `${p.label} · ` : ""}
            {cityLine}
          </span>
        </span>
        {nav ? (
          <a
            href={nav}
            target="_blank"
            rel="noopener noreferrer"
            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-accent px-4 text-subhead font-semibold text-on-accent"
          >
            <Navigation size={16} aria-hidden /> Navigate
          </a>
        ) : null}
      </div>
    );
  }

  const [rows, defs] = await Promise.all([
    execRows<{
      custom: Record<string, unknown> | null;
      property_type: string | null;
    }>(
      sql`select custom, property_type from properties where id = ${propertyId}`,
    ),
    getCustomFieldDefs("property").catch(() => []),
  ]);
  const custom = rows[0]?.custom ?? {};
  const equipment = defs
    .filter((d) => custom[d.key] != null && custom[d.key] !== "")
    .map((d) => ({ label: d.label, value: String(custom[d.key]) }));

  return (
    <ListSection
      header={p.label ? `Service address · ${p.label}` : "Service address"}
      footer={
        p.masked
          ? "The full address, access notes and site phone show from 2 h before your visit."
          : undefined
      }
    >
      {nav ? (
        <a
          href={nav}
          target="_blank"
          rel="noopener noreferrer"
          className="row-press flex min-h-11 items-center gap-3 px-4 py-3"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-body">{p.addressShort}</span>
            <span className="block text-subhead text-label-2">{cityLine}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-pill bg-accent px-3.5 py-1.5 text-subhead font-semibold text-on-accent">
            <Navigation size={15} aria-hidden /> Navigate
          </span>
        </a>
      ) : (
        <div className="flex min-h-11 items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-body">{p.addressShort}</span>
            <span className="block text-subhead text-label-2">{cityLine}</span>
          </span>
        </div>
      )}
      {p.gateCode ? (
        <ListRow
          icon={<KeyRound size={17} />}
          iconTone="orange"
          title="Gate / door code"
          detail={<span className="font-mono text-label">{p.gateCode}</span>}
        />
      ) : null}
      {p.accessNotes ? (
        <ListRow
          icon={<StickyNote size={17} />}
          iconTone="yellow"
          title="Access notes"
          subtitle={p.accessNotes}
          multiline
        />
      ) : null}
      {p.pets ? (
        <ListRow
          icon={<PawPrint size={17} />}
          iconTone="brown"
          title="Pets"
          subtitle={p.pets}
          multiline
        />
      ) : null}
      {p.siteContactName || p.siteContactPhone ? (
        p.siteContactPhone && !p.masked ? (
          <CallButton
            customerId={p.customerId}
            jobId={jobId}
            which="site"
            propertyId={p.id}
            variant="row"
            label={`Site contact${p.siteContactName ? `: ${p.siteContactName}` : ""}`}
            subtitle={formatPhoneDisplay(p.siteContactPhone)}
          />
        ) : (
          <ListRow
            icon={<UserRound size={17} />}
            iconTone="indigo"
            title="Site contact"
            detail={
              [p.siteContactName, p.siteContactPhone]
                .filter(Boolean)
                .join(" · ") || undefined
            }
          />
        )
      ) : null}
      {rows[0]?.property_type ? (
        <ListRow
          icon={<Building2 size={17} />}
          iconTone="gray"
          title="Property type"
          detail={<span className="capitalize">{rows[0].property_type}</span>}
        />
      ) : null}
      {equipment.map((e) => (
        <ListRow key={e.label} title={e.label} detail={e.value} />
      ))}
    </ListSection>
  );
}
