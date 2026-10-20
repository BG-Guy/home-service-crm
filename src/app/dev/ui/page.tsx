import {
  Bell,
  Briefcase,
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  FileText,
  Inbox,
  KeyRound,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Plus,
  Star,
  Trash,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { Badge } from "@/ui/components/Badge";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { Card } from "@/ui/components/Card";
import { Chip, ChipRow, TagChip } from "@/ui/components/Chip";
import {
  BarChart,
  DonutChart,
  LineChart,
  ProgressRing,
  Sparkline,
} from "@/ui/components/charts";
import { EmptyState } from "@/ui/components/EmptyState";
import { FeatureGate } from "@/ui/components/FeatureGate";
import {
  DateField,
  Select,
  TextArea,
  TextField,
  TimeField,
} from "@/ui/components/Field";
import { IconButton } from "@/ui/components/IconButton";
import { KeyValueList } from "@/ui/components/KeyValueList";
import {
  ListGroup,
  ListRow,
  ListSection,
  SectionHeader,
} from "@/ui/components/List";
import { MessageBubble, MessageSeparator } from "@/ui/components/MessageBubble";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { ReadinessRing, RiskChip, ScoreBreakdown } from "@/ui/components/Score";
import {
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SkeletonStat,
  SkeletonText,
} from "@/ui/components/Skeleton";
import { SlotPlaceholder } from "@/ui/components/SlotPlaceholder";
import { Spinner } from "@/ui/components/Spinner";
import { StatCard } from "@/ui/components/StatCard";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { TechCard } from "@/ui/components/TechCard";
import { Timeline, TripTimeline } from "@/ui/components/Timeline";
import { Toggle } from "@/ui/components/Toggle";
import { PageTransition, PushLink } from "@/ui/motion/PageTransition";
import { STATUS, type StatusKind } from "@/ui/status";
import {
  ControlDemos,
  FieldDemos,
  GalleryAddMenu,
  GestureDemos,
  IconButtonDemo,
  InstallDemo,
  MapDemo,
  MediaDemos,
  OverlayDemos,
  ThemeToggle,
  ToastDemos,
} from "./demos";
import { devUiEnabled } from "./enabled";

export const metadata: Metadata = {
  title: "UI Gallery",
  robots: { index: false, follow: false },
};

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16">
      <h2 id={`${id}-h`} className="mb-1 text-title1">
        {title}
      </h2>
      {note && <p className="mb-4 text-subhead text-label-2">{note}</p>}
      <div className={note ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

/** Small caption above a demo row. */
function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-footnote font-semibold text-label-2">{label}</span>
      {children}
    </div>
  );
}

const NAV = [
  ["buttons", "Buttons"],
  ["surfaces", "Cards & headers"],
  ["lists", "Lists"],
  ["status", "Status"],
  ["people", "People"],
  ["controls", "Controls"],
  ["fields", "Fields"],
  ["overlays", "Overlays"],
  ["feedback", "Feedback"],
  ["data", "Data"],
  ["activity", "Activity"],
  ["motion", "Motion"],
  ["media", "Media"],
  ["map", "Map"],
  ["loading", "Loading"],
] as const;

const VARIANTS = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["tinted", "Tinted"],
  ["plain", "Plain"],
  ["destructive", "Destructive (confirm)"],
] as const;

export default async function UiGalleryPage() {
  await connection();
  if (!devUiEnabled()) notFound();
  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  return (
    <PageTransition>
      <LargeTitleHeader
        title="UI Gallery"
        subtitle="Every primitive and state · src/ui"
        trailing={<GalleryAddMenu />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ThemeToggle />
          <PushLink
            href="/dev/ui/shell"
            className="text-subhead font-semibold text-accent-text"
          >
            App shell + push transition →
          </PushLink>
        </div>
        <ChipRow label="Jump to section" className="mt-3">
          {NAV.map(([id, label]) => (
            <Chip key={id} href={`#${id}`}>
              {label}
            </Chip>
          ))}
        </ChipRow>
      </LargeTitleHeader>

      <Page className="flex flex-col gap-14 pb-24 pt-4">
        <Banner tone="info" title="Reduced motion">
          Turn on “Reduce Motion” in the OS to check fallbacks: sheets
          crossfade, page pushes fade, switches and thumbs snap, skeletons and
          live dots stop.
        </Banner>

        {/* ------------------------------------------------------------ */}
        <Section
          id="buttons"
          title="Buttons"
          note="One primary per view. Pills: sm 34 · md 44 · lg 52. Press = M9 (scale .97 + dim)."
        >
          <div className="flex flex-col gap-6">
            {VARIANTS.map(([v, name]) => (
              <Demo key={v} label={name}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant={v} size="lg">
                    Large
                  </Button>
                  <Button variant={v}>Medium</Button>
                  <Button variant={v} size="sm">
                    Small
                  </Button>
                  <Button variant={v} icon={<Plus size={18} />}>
                    Icon
                  </Button>
                  <Button variant={v} loading>
                    Loading
                  </Button>
                  <Button variant={v} disabled>
                    Disabled
                  </Button>
                </div>
              </Demo>
            ))}
            <Demo label="Destructive role (red text, no fill)">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="plain" destructive icon={<Trash size={18} />}>
                  Delete
                </Button>
                <Button variant="secondary" destructive>
                  Remove tag
                </Button>
                <Button variant="tinted" destructive size="sm">
                  Stop texts
                </Button>
              </div>
            </Demo>
            <Demo label="Loading with text · block · link">
              <div className="flex flex-col gap-2">
                <Button size="lg" block loading loadingText="Saving…">
                  Save
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  block
                  href="/dev/ui/shell"
                  transition="push"
                >
                  Block link (push)
                </Button>
              </div>
            </Demo>
            <Demo label="Icon buttons · plain / secondary / tinted / primary / material">
              <div className="flex flex-wrap items-center gap-2">
                <IconButton label="Call">
                  <Phone size={22} />
                </IconButton>
                <IconButton label="Call" variant="secondary">
                  <Phone size={20} />
                </IconButton>
                <IconButton label="Text" variant="secondary" size={36}>
                  <MessageCircle size={18} />
                </IconButton>
                <IconButton label="Navigate" variant="tinted">
                  <Navigation size={20} />
                </IconButton>
                <IconButton label="Add" variant="primary" size={48}>
                  <Plus size={22} />
                </IconButton>
                <IconButton label="Delete" variant="secondary" destructive>
                  <Trash size={20} />
                </IconButton>
                <IconButton
                  label="Notifications"
                  variant="secondary"
                  badge={<Badge count={3} tone="red" />}
                >
                  <Bell size={20} />
                </IconButton>
                <IconButtonDemo />
              </div>
            </Demo>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="surfaces"
          title="Cards & headers"
          note="Calm surfaces: --card, radius 20, soft shadow (a hairline in dark). Tappable cards press and lift on hover."
        >
          <div className="flex flex-col gap-6">
            <div>
              <SectionHeader
                title="Current job"
                subtitle="Hero card: status, title, two facts, one primary"
                actionHref="/dev/ui/shell"
              />
              <Card padding="lg">
                <StatusPill kind="job" status="en_route" />
                <h3 className="mt-3 text-title2">Lockout · front door</h3>
                <p className="mt-1 text-subhead text-label-2">
                  Jordan Lee · 12 Oak St, Brookline
                </p>
                <p className="text-subhead text-label-2">
                  Window 10:00–12:00 AM
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Button size="lg" className="flex-1">
                    Arrived
                  </Button>
                  <IconButton label="Call" variant="secondary" size={48}>
                    <Phone size={20} />
                  </IconButton>
                  <IconButton label="Text" variant="secondary" size={48}>
                    <MessageCircle size={20} />
                  </IconButton>
                  <IconButton label="Navigate" variant="secondary" size={48}>
                    <Navigation size={20} />
                  </IconButton>
                </div>
              </Card>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Card>
                <p className="text-headline">Static card</p>
                <p className="mt-1 text-subhead text-label-2">
                  padding md (16 / 20)
                </p>
              </Card>
              <Card href="/dev/ui/shell">
                <p className="text-headline">Link card</p>
                <p className="mt-1 text-subhead text-label-2">
                  Press + hover lift (M9, M16)
                </p>
              </Card>
              <Card>
                <p className="text-headline">Nested surface</p>
                <Card nested padding="sm" className="mt-2">
                  <p className="text-subhead text-label-2">
                    --card-2 inside a card
                  </p>
                </Card>
              </Card>
            </div>
            <ListSection
              variant="title"
              header="Needs attention"
              subtitle="Title variant: 20/700 for content pages"
              action={
                <Button size="sm" variant="tinted">
                  Review all
                </Button>
              }
            >
              <ListRow
                icon={<CalendarClock size={18} />}
                iconTone="orange"
                title="3 jobs unconfirmed"
                subtitle="Tomorrow"
                bold
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<CircleDollarSign size={18} />}
                iconTone="red"
                title="2 invoices overdue"
                subtitle="$1,240.00"
                bold
                href="/dev/ui/shell"
              />
            </ListSection>
            <ListSection
              header="Caption variant"
              footer="15/600 secondary, sentence case: settings and forms."
            >
              <ListRow title="Business hours" detail="Mon–Fri" href="#" />
              <ListRow
                title="Quiet hours"
                accessory={<Toggle label="Quiet hours" defaultChecked />}
              />
            </ListSection>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="lists" title="Lists">
          <ListGroup>
            <ListSection
              header="Settings style"
              footer="52 px rows, tinted 32 px tiles, separators inset to the text."
            >
              <ListRow
                icon={<Briefcase size={18} />}
                iconTone="orange"
                title="Jobs"
                detail="12"
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<Truck size={18} />}
                iconTone="indigo"
                title="Vehicles"
                accessory="badge"
                badge={3}
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<CreditCard size={18} />}
                iconTone="green"
                title="Disputes"
                accessory="badge"
                badge={2}
                badgeCritical
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<Bell size={18} />}
                iconTone="red"
                iconStyle="filled"
                title="Filled tile"
                accessory={<Toggle label="Notifications" defaultChecked />}
              />
              <ListRow
                icon={<Star size={18} />}
                iconTone="yellow"
                title="Long subtitle"
                subtitle="With a subtitle that is long enough to truncate on a phone screen"
              />
            </ListSection>
            <ListSection header="Rich rows (content lists)">
              <ListRow
                leading={
                  <Avatar
                    name="Maria Ortega"
                    seed="u1"
                    size={40}
                    status="online"
                  />
                }
                sepInset={68}
                title="Maria Ortega"
                subtitle="Lead tech · 4 jobs today"
                bold
                detail={
                  <StatusPill
                    kind="job"
                    status="in_progress"
                    size="sm"
                    live={false}
                  />
                }
                href="/dev/ui/shell"
              />
              <ListRow
                leading={<Avatar name="Dev Patel" seed="u2" size={40} />}
                sepInset={68}
                title="Dev Patel"
                subtitle="Office"
                bold
                detail={<StatusPill kind="user" status="invited" size="sm" />}
                href="/dev/ui/shell"
              />
              <ListRow
                leading={<Avatar name="Kim Wu" seed="u3" size={40} />}
                sepInset={68}
                title="Kim Wu"
                subtitle="Rekey · 4 Elm Ave"
                bold
                detail={<MoneyText cents={18000} className="text-label" />}
                href="/dev/ui/shell"
              />
            </ListSection>
            <ListSection header="Dense rows, selection">
              <ListRow dense title="Cash" accessory="check" />
              <ListRow dense title="Card" />
              <ListRow dense title="Check" disabled />
            </ListSection>
            <ListSection>
              <ListRow
                title="Sign out"
                centered
                destructive
                href="/dev/ui"
                accessory="none"
              />
            </ListSection>
            <KeyValueList
              items={[
                { label: "Customer", value: "Jordan Lee" },
                {
                  label: "Phone",
                  value: "(555) 123-4567",
                  href: "tel:+15551234567",
                },
                {
                  label: "Total",
                  value: <MoneyText cents={24500} />,
                  numeric: true,
                },
                { label: "Gate code", value: null },
                {
                  label: "Access notes",
                  value: "Side gate, dog in yard.\nCall on arrival.",
                  stacked: true,
                },
              ]}
            />
          </ListGroup>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="status"
          title="Status, badges, chips"
          note="Soft tint + AA ink. Live states (on the way, in progress) pulse their dot (M12)."
        >
          <div className="flex flex-col gap-5">
            <Demo label="Live">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill kind="job" status="en_route" />
                <StatusPill kind="job" status="in_progress" />
                <Pill tone="green" live>
                  On the clock · 2h 14m
                </Pill>
              </div>
            </Demo>
            {(Object.keys(STATUS) as StatusKind[]).map((kind) => (
              <div key={kind} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 shrink-0 text-footnote text-label-2">
                  {kind}
                </span>
                {Object.keys(STATUS[kind]).map((s) => (
                  <StatusPill
                    key={s}
                    kind={kind}
                    status={s}
                    size="sm"
                    live={false}
                  />
                ))}
              </div>
            ))}
            <Demo label="Badges (M11 pop on change with `pop`) · risk">
              <div className="flex flex-wrap items-center gap-2">
                <Badge count={3} />
                <Badge count={12} tone="red" label="12 overdue" pop />
                <Badge count={240} tone="accent" />
                <Badge dot tone="red" label="Unread" />
                <Pill tone="teal">Custom pill</Pill>
                <RiskChip band="low" />
                <RiskChip band="medium" score={32} />
                <RiskChip band="high" />
                <RiskChip band="critical" score={81} size="sm" />
              </div>
            </Demo>
            <Demo label="Filter chips: ChipRow scrolls with snap and edge fades">
              <ChipRow label="Filters">
                <Chip selected count={8}>
                  All
                </Chip>
                <Chip count={3}>Today</Chip>
                <Chip icon={<MapPin size={14} />}>Nearby</Chip>
                <Chip>Unpaid</Chip>
                <Chip>Unscheduled</Chip>
                <Chip>Needs estimate</Chip>
                <Chip>Warranty</Chip>
                <Chip>Commercial</Chip>
              </ChipRow>
            </Demo>
            <div className="flex flex-wrap gap-1.5">
              <TagChip name="VIP" color="#ff9500" />
              <TagChip name="Commercial" tone="indigo" />
              <TagChip name="Warranty" tone="green" size="sm" />
              <TagChip name="Dog on site" tone="yellow" />
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="people" title="People">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end gap-4">
              {[24, 32, 40, 48, 64].map((s, i) => (
                <Avatar
                  key={s}
                  name={
                    ["Ana Ruiz", "Ben Ko", "Cy Diaz", "Dee", "Eve Sun"][i] ??
                    "X"
                  }
                  seed={`s${i}`}
                  size={s}
                  status={i === 2 ? "busy" : undefined}
                  presence={i === 3}
                  ring={i === 4 ? "accent" : undefined}
                />
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <TechCard
                firstName="Tom"
                seed="u4"
                rating={4.9}
                ratingCount={212}
                status={<StatusPill kind="job" status="en_route" size="sm" />}
                eta="12 min"
                vehicle="White Ford Transit · 7XJ 221"
                phoneHref="tel:+15551234567"
                smsHref="sms:+15551234567"
                presence
              />
              <TechCard
                firstName="Maria"
                seed="u1"
                licenseNo="LS-20931"
                rating={4.9}
                ratingCount={212}
                subtitle="Your technician · arriving 2:30–3:00 PM"
              />
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="controls"
          title="Controls"
          note="Segmented thumb slides with transform only (M14)."
        >
          <ControlDemos />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="fields"
          title="Fields"
          note="Filled 48 px, 13/600 label above. Focus = 2 px accent ring + glow; errors shake (M18)."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <FieldDemos />
            <div className="flex flex-col gap-4">
              <TextField label="Job title" placeholder="Rekey 3 locks" />
              <TextField
                label="With error"
                defaultValue="abc"
                error="Enter a valid ZIP code"
              />
              <TextField
                label="Disabled"
                defaultValue="Read only"
                disabled
                hint="Locked after the invoice is issued."
              />
              <TextArea label="Notes" hint="Visible to the office only." />
              <Select
                label="Service type"
                placeholder="Choose…"
                options={[
                  { value: "lockout", label: "Lockout" },
                  { value: "rekey", label: "Rekey" },
                  { value: "garage", label: "Garage door repair" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <DateField label="Date" />
                <TimeField label="Time" step={900} />
              </div>
              <Card>
                <p className="mb-3 text-headline">Fields on a card</p>
                <TextField label="Email" placeholder="name@example.com" />
              </Card>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="overlays"
          title="Sheets, alerts, menus"
          note="Native <dialog>: Esc, focus containment and restore come free."
        >
          <div className="flex flex-col gap-6">
            <OverlayDemos />
            <GestureDemos />
            <InstallDemo />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section id="feedback" title="Feedback">
          <div className="flex flex-col gap-3">
            <ToastDemos />
            <Banner tone="success" title="Payment received">
              $245.00 by card.
            </Banner>
            <Banner tone="warning" title="Unconfirmed">
              Customer hasn&apos;t confirmed tomorrow&apos;s visit.
            </Banner>
            <Banner
              tone="error"
              action={
                <Button size="sm" variant="secondary">
                  Retry
                </Button>
              }
            >
              Couldn&apos;t load payments.
            </Banner>
            <Banner tone="legal" title="Wage deductions are regulated">
              Check your state&apos;s rules before enabling tool-loss
              deductions.
            </Banner>
            <Banner tone="offline">
              You&apos;re offline. Changes will sync.
            </Banner>
            <div className="grid gap-3 md:grid-cols-2">
              <Card padding="none">
                <EmptyState
                  icon={<Inbox size={48} strokeWidth={1.5} />}
                  title="No messages"
                  message="Texts you send or receive show up here."
                  action={
                    <Button
                      variant="secondary"
                      icon={<MessageCircle size={18} />}
                    >
                      New message
                    </Button>
                  }
                />
              </Card>
              <Card padding="none">
                <EmptyState
                  icon={<Users />}
                  tone="green"
                  title="No customers yet"
                  message="Import a CSV or add your first customer."
                  action={<Button>Add customer</Button>}
                />
              </Card>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <SuccessCheck label="Payment received" />
              <SuccessCheck size={40} tone="accent" label="Sent" />
              <span className="flex items-center gap-3 text-label-2">
                <Spinner /> <Spinner size={28} />
                <span className="text-footnote">Activity indicator</span>
              </span>
            </div>
            <SlotPlaceholder name="S2 PropertyCard" />
            <FeatureGate
              enabled={false}
              fallback={
                <p className="text-footnote text-label-2">
                  FeatureGate: flag off → fallback rendered.
                </p>
              }
            >
              <p>Hidden</p>
            </FeatureGate>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="data"
          title="Stats & charts"
          note="Server-rendered SVG/HTML; tabular numbers; money never truncates."
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="Revenue"
                icon={<CircleDollarSign size={14} />}
                value={<MoneyText cents={1_284_000} compactWhole />}
                delta={{ value: 0.12, label: "vs last wk" }}
                chart={
                  <Sparkline
                    values={[3, 5, 4, 6, 8, 7, 9]}
                    label="Revenue, 7 days"
                  />
                }
                href="/dev/ui/shell"
              />
              <StatCard
                label="Jobs done"
                value="38"
                delta={{ value: -0.05, label: "vs last wk" }}
                chart={
                  <Sparkline
                    values={[9, 8, 8, 7, 6, 7, 6]}
                    tone="orange"
                    label="Jobs, 7 days"
                  />
                }
              />
              <StatCard
                label="Avg response"
                value="4m 12s"
                delta={{ value: -0.3, goodWhen: "down", label: "faster" }}
              />
              <StatCard
                label="Disputes"
                value="0"
                delta={{ value: 0, format: "number" }}
                footnote="Last 90 days"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatCard size="sm" label="Jobs done" value="3" />
              <StatCard
                size="sm"
                label="Earned today"
                value={<MoneyText cents={48_250} />}
              />
              <StatCard
                size="sm"
                label="Cash held"
                value={<MoneyText cents={12_000} />}
                href="/dev/ui/shell"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-headline">Revenue by week</h3>
                <BarChart
                  title="Revenue by week"
                  format="money"
                  data={[
                    { label: "W36", value: 820000 },
                    { label: "W37", value: 960000 },
                    { label: "W38", value: 710000 },
                    { label: "W39", value: 1104000 },
                    { label: "W40", value: 1284000, tone: "indigo" },
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-headline">Lead sources</h3>
                <BarChart
                  orientation="horizontal"
                  title="Leads by source"
                  data={[
                    { label: "Google Ads", value: 48 },
                    { label: "Website form", value: 31 },
                    { label: "Thumbtack", value: 17 },
                    { label: "Referral", value: 9 },
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-headline">Booked vs completed</h3>
                <LineChart
                  title="Booked vs completed jobs"
                  labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                  series={[
                    { name: "Booked", values: [12, 15, 11, 18, 21, 9, 4] },
                    {
                      name: "Completed",
                      values: [10, 14, 12, 15, 19, 10, null],
                    },
                  ]}
                />
              </Card>
              <Card>
                <h3 className="mb-3 text-headline">Payment mix</h3>
                <DonutChart
                  title="Payment mix"
                  format="money"
                  segments={[
                    { label: "Card", value: 812000 },
                    { label: "Cash", value: 240000 },
                    { label: "Check", value: 130000 },
                    { label: "ACH", value: 102000 },
                  ]}
                />
              </Card>
            </div>
            <Card className="flex flex-wrap items-center gap-4">
              <ProgressRing value={0.6} label="Checklist 3 of 5" />
              <ProgressRing value={1} size={56} tone="green" label="Done">
                ✓
              </ProgressRing>
              <ReadinessRing score={92} />
              <ReadinessRing score={64} size={44} />
              <ReadinessRing score={31} size={52} />
              <ReadinessRing score={null} />
            </Card>
            <ScoreBreakdown
              items={[
                {
                  label: "Signed estimate with policies",
                  points: 25,
                  weight: 25,
                  state: "met",
                },
                {
                  label: "Completion acknowledgment",
                  points: 0,
                  weight: 20,
                  state: "missing",
                  hint: "Ask the customer to sign on your phone.",
                },
                {
                  label: "Before/after photos",
                  points: 15,
                  weight: 15,
                  state: "na",
                  hint: "Photos are off for this company.",
                },
              ]}
            />
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="activity"
          title="Timelines & messages"
          note="TripTimeline: done = filled, current = accent + pulse, upcoming = hollow."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <Card padding="lg">
              <SectionHeader title="Today's route" as="h3" />
              <TripTimeline
                label="Today's route"
                steps={[
                  {
                    id: "r1",
                    state: "done",
                    time: "8:00 AM",
                    title: "Rekey 3 locks",
                    body: "12 Oak St",
                  },
                  {
                    id: "r2",
                    state: "done",
                    time: "9:30 AM",
                    title: "Garage door tune-up",
                    body: "88 Pine Rd",
                  },
                  {
                    id: "r3",
                    state: "current",
                    time: "11:00 AM",
                    title: "Lockout · front door",
                    body: "4 Elm Ave",
                    aside: (
                      <StatusPill
                        kind="job"
                        status="en_route"
                        size="sm"
                        live={false}
                      />
                    ),
                  },
                  {
                    id: "r4",
                    state: "upcoming",
                    time: "1:00 PM",
                    title: "Smart lock install",
                    body: "230 Main St",
                  },
                  {
                    id: "r5",
                    state: "upcoming",
                    time: "3:30 PM",
                    title: "Estimate visit",
                  },
                ]}
              />
            </Card>
            <Card padding="lg">
              <SectionHeader title="Job status" as="h3" />
              <TripTimeline
                label="Job status"
                live={false}
                steps={[
                  { id: "s1", state: "done", title: "Booked" },
                  { id: "s2", state: "done", title: "Confirmed" },
                  {
                    id: "s3",
                    state: "current",
                    title: "On the way",
                    body: "Tom · arriving in 12 min",
                  },
                  { id: "s4", state: "upcoming", title: "Arrived" },
                  { id: "s5", state: "upcoming", title: "Done" },
                ]}
              />
            </Card>
            <Timeline
              timeZone="America/New_York"
              now={now}
              items={[
                {
                  id: "1",
                  at: ago(5),
                  title: "Payment received",
                  body: "$245.00 · Visa 4242",
                  tone: "green",
                  icon: <CreditCard size={15} />,
                  actor: "Maria",
                },
                {
                  id: "2",
                  at: ago(40),
                  title: "Job completed",
                  tone: "blue",
                  icon: <Wrench size={15} />,
                  actor: "Maria",
                  aside: <StatusPill kind="job" status="completed" size="sm" />,
                },
                {
                  id: "3",
                  at: ago(60 * 26),
                  title: "Estimate approved",
                  body: "Option B · Rekey + smart lock",
                  tone: "indigo",
                  icon: <FileText size={15} />,
                },
                {
                  id: "4",
                  at: ago(60 * 24 * 5),
                  title: "Call logged",
                  tone: "gray",
                  icon: <Phone size={15} />,
                  actor: "Office",
                },
              ]}
            />
            <Card padding="sm">
              <MessageSeparator>Today 9:41 AM</MessageSeparator>
              <MessageBubble direction="in" tail={false}>
                Hi, are you still coming today?
              </MessageBubble>
              <MessageBubble direction="in">Gate code is 4412</MessageBubble>
              <MessageBubble direction="out" tail={false}>
                Yes! Maria is on the way.
              </MessageBubble>
              <MessageBubble
                direction="out"
                meta="9:43 AM"
                status="Delivered"
                channel="SMS"
              >
                Track her here: example.com/t/abc
              </MessageBubble>
              <MessageBubble
                direction="out"
                failed
                meta="9:44 AM"
                status="Failed"
              >
                Sorry, one more thing…
              </MessageBubble>
            </Card>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="motion"
          title="Motion utilities"
          note="CSS only: .pressable (M9), .hover-lift (M16), .live-dot (M12), .shimmer (M13), .disclosure (M15)."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="pressable hover-lift">
              <p className="text-headline">.pressable .hover-lift</p>
              <p className="mt-1 text-subhead text-label-2">
                Press me; hover on desktop.
              </p>
            </Card>
            <Card className="flex items-center gap-3">
              <span className="live-dot" />
              <span
                className="live-dot"
                style={{ ["--tone" as string]: "var(--accent)" }}
              />
              <span className="text-subhead text-label-2">Live dots</span>
            </Card>
            <Card className="shimmer">
              <p className="text-headline">.shimmer</p>
              <p className="mt-1 text-subhead text-label-2">Any surface.</p>
            </Card>
            <Card>
              <p className="text-headline">.disclosure (closed)</p>
              <div className="disclosure">
                <div>
                  <p className="pt-2 text-subhead text-label-2">Hidden</p>
                </div>
              </div>
            </Card>
            <Card>
              <p className="text-headline">.disclosure[data-open]</p>
              <div className="disclosure" data-open="">
                <div>
                  <p className="pt-2 text-subhead text-label-2">
                    grid-template-rows 0fr → 1fr, 280 ms.
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="media"
          title="Photos, signature, camera"
          note="Signature and compare load lazily."
        >
          <MediaDemos />
        </Section>

        <Section
          id="map"
          title="Map"
          note="Leaflet + CSS loaded on demand; tiles inverted in dark mode."
        >
          <MapDemo />
        </Section>

        {/* ------------------------------------------------------------ */}
        <Section
          id="loading"
          title="Skeletons"
          note="For loading.tsx; shimmer (M13) stops with reduced motion."
        >
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SkeletonStat />
              <SkeletonStat />
              <SkeletonStat />
              <SkeletonStat />
            </div>
            <SkeletonList rows={3} />
            <SkeletonList rows={2} leading="avatar" header={false} />
            <SkeletonCard />
            <div className="flex items-center gap-3">
              <Skeleton width={48} height={48} rounded="full" />
              <SkeletonText lines={3} className="flex-1" />
            </div>
          </div>
        </Section>

        <p className="flex items-center gap-2 text-footnote text-label-2">
          <KeyRound size={14} aria-hidden /> Dev only — 404 in production unless
          DEV_UI=1.
        </p>
      </Page>
    </PageTransition>
  );
}
