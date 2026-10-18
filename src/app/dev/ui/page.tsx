import {
  Bell,
  Briefcase,
  CircleDollarSign,
  CreditCard,
  FileText,
  Inbox,
  KeyRound,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Star,
  Truck,
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
import { Chip, ChipRow, TagChip } from "@/ui/components/Chip";
import {
  BarChart,
  DonutChart,
  LineChart,
  ProgressRing,
  Sparkline,
} from "@/ui/components/charts";
import { DateField } from "@/ui/components/DatePicker";
import { EmptyState } from "@/ui/components/EmptyState";
import { FeatureGate } from "@/ui/components/FeatureGate";
import { Select, TextArea, TextField } from "@/ui/components/Field";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
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
import { TechCard } from "@/ui/components/TechCard";
import { Timeline } from "@/ui/components/Timeline";
import { TimeField } from "@/ui/components/TimePicker";
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
  PickerDemos,
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
      <h2 id={`${id}-h`} className="mb-1 text-title2 font-bold tracking-tight">
        {title}
      </h2>
      {note && <p className="mb-3 text-subhead text-label-2">{note}</p>}
      <div className={note ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

const NAV = [
  ["buttons", "Buttons"],
  ["lists", "Lists"],
  ["status", "Status"],
  ["controls", "Controls"],
  ["fields", "Fields"],
  ["overlays", "Overlays"],
  ["feedback", "Feedback"],
  ["data", "Data"],
  ["activity", "Activity"],
  ["media", "Media"],
  ["map", "Map"],
  ["loading", "Loading"],
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
        subtitle="Every component and state · src/ui"
        trailing={<GalleryAddMenu />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <ThemeToggle />
          <PushLink
            href="/dev/ui/shell"
            className="text-subhead font-medium text-accent-text"
          >
            App shell + push transition →
          </PushLink>
        </div>
        <ChipRow label="Jump to section" className="mt-2">
          {NAV.map(([id, label]) => (
            <Chip key={id} href={`#${id}`}>
              {label}
            </Chip>
          ))}
        </ChipRow>
      </LargeTitleHeader>

      <Page className="flex flex-col gap-12 pb-24 pt-4">
        <Banner tone="info" title="Reduced motion">
          Turn on “Reduce Motion” in the OS to check fallbacks: sheets
          crossfade, page pushes fade, switches and thumbs snap, skeletons stop
          pulsing.
        </Banner>

        <Section id="buttons" title="Buttons">
          <div className="flex flex-col gap-4">
            {(
              ["filled", "tinted", "gray", "plain", "destructive"] as const
            ).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-2">
                <Button variant={v} size="lg">
                  {v}
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
            ))}
            <Button size="lg" fullWidth href="/dev/ui/shell" transition="push">
              Full width link (push)
            </Button>
            <IconButtonDemo />
          </div>
        </Section>

        <Section id="lists" title="Lists">
          <ListGroup>
            <ListSection
              header="Settings style"
              footer="Hairlines inset 60 px after icon rows."
            >
              <ListRow
                icon={<Briefcase size={17} />}
                iconTone="orange"
                title="Jobs"
                detail="12"
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<Truck size={17} />}
                iconTone="indigo"
                title="Vehicles"
                accessory="badge"
                badge={3}
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<CreditCard size={17} />}
                iconTone="green"
                title="Disputes"
                accessory="badge"
                badge={2}
                badgeCritical
                href="/dev/ui/shell"
              />
              <ListRow
                icon={<Bell size={17} />}
                iconTone="red"
                title="Notifications"
                accessory={<Toggle label="Notifications" defaultChecked />}
              />
              <ListRow
                icon={<Star size={17} />}
                iconStyle="tinted"
                iconTone="yellow"
                title="Tinted icon"
                subtitle="With a subtitle that is long enough to truncate on a phone screen"
              />
            </ListSection>
            <ListSection header="People">
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
                href="/dev/ui/shell"
              />
              <ListRow
                leading={<Avatar name="Dev Patel" seed="u2" size={40} />}
                sepInset={68}
                title="Dev Patel"
                subtitle="Office"
                detail={<StatusPill kind="user" status="invited" size="sm" />}
                href="/dev/ui/shell"
              />
            </ListSection>
            <ListSection header="Selection">
              <ListRow title="Cash" accessory="check" />
              <ListRow title="Card" />
              <ListRow title="Check" disabled />
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

        <Section id="status" title="Status, badges, chips, avatars">
          <div className="flex flex-col gap-4">
            {(Object.keys(STATUS) as StatusKind[]).map((kind) => (
              <div key={kind} className="flex flex-wrap items-center gap-1.5">
                <span className="w-32 shrink-0 text-footnote text-label-2">
                  {kind}
                </span>
                {Object.keys(STATUS[kind]).map((s) => (
                  <StatusPill key={s} kind={kind} status={s} size="sm" />
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Badge count={3} />
              <Badge count={12} tone="red" label="12 overdue" />
              <Badge count={240} tone="accent" />
              <Badge dot tone="red" label="Unread" />
              <Pill tone="teal">Custom pill</Pill>
              <RiskChip band="low" />
              <RiskChip band="medium" score={32} />
              <RiskChip band="high" />
              <RiskChip band="critical" score={81} size="sm" />
            </div>
            <ChipRow label="Filters">
              <Chip selected count={8}>
                All
              </Chip>
              <Chip count={3}>Today</Chip>
              <Chip icon={<MapPin size={14} />}>Nearby</Chip>
              <Chip>Unpaid</Chip>
            </ChipRow>
            <div className="flex flex-wrap gap-1.5">
              <TagChip name="VIP" color="#ff9500" />
              <TagChip name="Commercial" tone="indigo" />
              <TagChip name="Warranty" tone="green" size="sm" />
            </div>
            <div className="flex flex-wrap items-end gap-3">
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
                  ring={i === 4 ? "green" : undefined}
                />
              ))}
            </div>
            <TechCard
              firstName="Maria"
              seed="u1"
              licenseNo="LS-20931"
              rating={4.9}
              ratingCount={212}
              subtitle="Your technician · arriving 2:30–3:00 PM"
            />
          </div>
        </Section>

        <Section id="controls" title="Controls">
          <ControlDemos />
        </Section>

        <Section
          id="fields"
          title="Fields"
          note="17 px text (no iOS zoom), errors via aria-describedby."
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
            </div>
          </div>
        </Section>

        <Section
          id="pickers"
          title="Date and time pickers"
          note="The calendar window slides up as a sheet on touch screens and springs out of the field with a mouse; months slide left / right (arrows, swipe, PgUp/PgDn). Times: iOS wheels on touch, typed segments + AM/PM with a mouse."
        >
          <PickerDemos />
        </Section>

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
                <Button size="sm" variant="tinted">
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
            <div className="rounded-card bg-card shadow-card">
              <EmptyState
                icon={<Inbox size={48} strokeWidth={1.5} />}
                title="No messages"
                message="Texts you send or receive show up here."
                action={
                  <Button variant="tinted" icon={<MessageCircle size={18} />}>
                    New Message
                  </Button>
                }
              />
            </div>
            <div className="flex items-center gap-3 text-label-2">
              <Spinner /> <Spinner size={28} />{" "}
              <span className="text-footnote">Activity indicator</span>
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

        <Section
          id="data"
          title="Stats & charts"
          note="Server-rendered SVG/HTML; hover for native tooltips; screen readers get tables."
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
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-tile bg-card p-4 shadow-card">
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
              </div>
              <div className="rounded-tile bg-card p-4 shadow-card">
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
              </div>
              <div className="rounded-tile bg-card p-4 shadow-card">
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
              </div>
              <div className="rounded-tile bg-card p-4 shadow-card">
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
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 rounded-tile bg-card p-4 shadow-card">
              <ProgressRing value={0.6} label="Checklist 3 of 5" />
              <ProgressRing value={1} size={56} tone="green" label="Done">
                ✓
              </ProgressRing>
              <ReadinessRing score={92} />
              <ReadinessRing score={64} size={44} />
              <ReadinessRing score={31} size={52} />
              <ReadinessRing score={null} />
            </div>
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

        <Section id="activity" title="Timeline & messages">
          <div className="grid gap-6 md:grid-cols-2">
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
                  icon: <CreditCard size={14} />,
                  actor: "Maria",
                },
                {
                  id: "2",
                  at: ago(40),
                  title: "Job completed",
                  tone: "blue",
                  icon: <Wrench size={14} />,
                  actor: "Maria",
                  aside: <StatusPill kind="job" status="completed" size="sm" />,
                },
                {
                  id: "3",
                  at: ago(60 * 26),
                  title: "Estimate approved",
                  body: "Option B · Rekey + smart lock",
                  tone: "indigo",
                  icon: <FileText size={14} />,
                },
                {
                  id: "4",
                  at: ago(60 * 24 * 5),
                  title: "Call logged",
                  tone: "gray",
                  icon: <Phone size={14} />,
                  actor: "Office",
                },
              ]}
            />
            <div className="rounded-tile bg-card p-3 shadow-card">
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
            </div>
          </div>
        </Section>

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

        <Section
          id="loading"
          title="Skeletons"
          note="For loading.tsx; pulse stops with reduced motion."
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
