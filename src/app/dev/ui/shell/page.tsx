import { Briefcase, Phone, Search, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AddMenu } from "@/ui/components/AddMenu";
import {
  AppShell,
  DetailLayout,
  Page,
  type ShellNav,
} from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { Card } from "@/ui/components/Card";
import { IconButton } from "@/ui/components/IconButton";
import { ListRow, ListSection, SectionHeader } from "@/ui/components/List";
import { LazyPullToRefresh } from "@/ui/components/lazy";
import { LargeTitleHeader, NavBar } from "@/ui/components/NavBar";
import { StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import { PageTransition } from "@/ui/motion/PageTransition";
import { devUiEnabled } from "../enabled";
import { DEMO_JOBS, type DemoJob, money } from "./demo-data";
import { OverlayDemos } from "./OverlayDemos";

export const metadata: Metadata = {
  title: "Shell demo",
  robots: { index: false, follow: false },
};

// The shell gallery: one route, three screens (the list, `?job=<id>` and
// `?view=overlays`). The screens swap under a keyed PageTransition, so rows push
// (M1) and their avatar and title morph into the detail hero (M3); the tab bar
// cross-fades between Jobs and Overlays (M2). One route on purpose: it adds no
// route types for the typecheck.
const nav: ShellNav = {
  tabs: [
    {
      key: "jobs",
      href: "/dev/ui/shell",
      label: "Jobs",
      icon: "jobs",
      badgeKey: "leads.new",
    },
    {
      key: "overlays",
      href: "/dev/ui/shell?view=overlays",
      label: "Overlays",
      icon: "dashboard",
    },
    { key: "gallery", href: "/dev/ui", label: "Gallery", icon: "more" },
  ],
  sections: [
    {
      title: "Demo",
      items: [
        {
          key: "jobs",
          href: "/dev/ui/shell",
          label: "Jobs",
          icon: "jobs",
          badgeKey: "leads.new",
        },
        {
          key: "overlays",
          href: "/dev/ui/shell?view=overlays",
          label: "Overlays",
          icon: "dashboard",
          badgeKey: "disputes.open",
        },
      ],
    },
    {
      items: [
        { key: "gallery", href: "/dev/ui", label: "UI gallery", icon: "more" },
      ],
    },
  ],
};

function ListScreen() {
  return (
    <>
      <LazyPullToRefresh />
      <LargeTitleHeader
        title="Jobs"
        subtitle="Tap a row: it pushes, and its avatar and title fly into the hero."
        trailing={
          <>
            <IconButton label="Search">
              <Search aria-hidden size={22} />
            </IconButton>
            <AddMenu
              title="Create"
              label="Create new"
              items={[
                {
                  label: "New job",
                  href: "/dev/ui/shell?job=1042",
                  icon: <Briefcase aria-hidden size={20} />,
                },
                {
                  label: "New lead",
                  href: "/dev/ui/shell?job=1043",
                  icon: <UserPlus aria-hidden size={20} />,
                },
                {
                  label: "New customer",
                  href: "/dev/ui/shell?job=1044",
                  icon: <Users aria-hidden size={20} />,
                },
              ]}
            />
          </>
        }
      />
      <Page className="flex flex-col gap-[var(--section-gap)] pt-2">
        <section aria-labelledby="demo-today">
          <SectionHeader id="demo-today" title="Today" />
          {/* M8: the rows fade up 30 ms apart (first load and tab switches). */}
          <ul className="list-card enter-stagger">
            {DEMO_JOBS.map((j) => (
              <li key={j.id}>
                <ListRow
                  href={`/dev/ui/shell?job=${j.id}`}
                  bold
                  leading={
                    <Morph name={`demo-job-${j.id}-avatar`}>
                      <span className="inline-flex">
                        <Avatar name={j.customer} seed={j.customer} size={40} />
                      </span>
                    </Morph>
                  }
                  title={
                    <Morph name={`demo-job-${j.id}-title`}>
                      <span className="inline-block max-w-full truncate align-top">
                        {j.title}
                      </span>
                    </Morph>
                  }
                  subtitle={`${j.customer} · ${j.window}`}
                  detail={<StatusPill kind="job" status={j.status} size="sm" />}
                />
              </li>
            ))}
          </ul>
        </section>
        <p className="px-1 text-footnote text-label-2">
          The tab bar is a glass capsule with a sliding pill; the inline bar
          turns to glass once content scrolls under it. Overlays (sheets, menus,
          alerts, toasts) are on the next tab.
        </p>
      </Page>
    </>
  );
}

function DetailScreen({ job }: { job: DemoJob }) {
  return (
    <>
      <NavBar
        title={job.number}
        back={{ href: "/dev/ui/shell", label: "Jobs" }}
        trailing={
          <IconButton label="Call customer" href="tel:+15125550132">
            <Phone aria-hidden size={20} />
          </IconButton>
        }
      />
      <Page className="pt-4">
        <DetailLayout
          rail={
            <>
              <Card>
                <div className="text-subhead font-semibold">Technician</div>
                <div className="mt-3 flex items-center gap-3">
                  <Avatar name="Tom Baker" seed="Tom Baker" size={44} />
                  <div className="min-w-0">
                    <div className="text-headline">Tom Baker</div>
                    <div className="text-footnote text-label-2">
                      Ford Transit · ETA 12 min
                    </div>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="text-subhead font-semibold">Money</div>
                <div className="num mt-2 text-title2 font-bold">
                  {money(job.amountCents)}
                </div>
                <div className="text-footnote text-label-2">
                  Estimate approved · deposit paid
                </div>
              </Card>
            </>
          }
          bar={
            <BottomBar
              summary={
                <BarSummary
                  title={money(job.amountCents)}
                  subtitle="Balance due"
                />
              }
              action={<Button size="lg">Collect</Button>}
            />
          }
        >
          <Card padding="lg">
            <div>
              <StatusPill kind="job" status={job.status} />
            </div>
            <Morph name={`demo-job-${job.id}-title`}>
              <h1 className="mt-3 inline-block text-title2 font-bold tracking-tight">
                {job.title}
              </h1>
            </Morph>
            <div className="mt-4 flex items-center gap-3">
              <Morph name={`demo-job-${job.id}-avatar`}>
                <span className="inline-flex">
                  <Avatar name={job.customer} seed={job.customer} size={48} />
                </span>
              </Morph>
              <div className="min-w-0">
                <div className="text-headline">{job.customer}</div>
                <div className="text-footnote text-label-2">
                  {job.window} · {job.address}
                </div>
              </div>
            </div>
          </Card>
          {["Details", "Line items", "Notes"].map((h) => (
            <ListSection key={h} header={h} variant="title">
              {[1, 2, 3, 4].map((n) => (
                <ListRow
                  key={n}
                  title={`${h} row ${n}`}
                  subtitle="Scroll: the bar turns to glass; the bottom bar stays clear of the content"
                />
              ))}
            </ListSection>
          ))}
        </DetailLayout>
      </Page>
    </>
  );
}

function OverlaysScreen() {
  return (
    <>
      <LargeTitleHeader
        title="Overlays"
        subtitle="Sheets, menus, alerts and toasts"
      />
      <Page className="pt-2">
        <OverlayDemos />
      </Page>
    </>
  );
}

export default async function ShellDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; view?: string }>;
}) {
  await connection();
  if (!devUiEnabled()) notFound();
  const sp = await searchParams;
  const job = DEMO_JOBS.find((j) => j.id === sp.job);
  const view = job
    ? `job-${job.id}`
    : sp.view === "overlays"
      ? "overlays"
      : "list";
  return (
    <AppShell
      user={{ id: "u1", name: "Maria Ortega", roleLabel: "Office" }}
      nav={nav}
      badges={{ "leads.new": 3, "disputes.open": 1 }}
      brand="Acme Locksmith"
    >
      {/* Keyed: each screen enters and exits like a page of its own. */}
      <PageTransition key={view}>
        {job ? (
          <DetailScreen job={job} />
        ) : view === "overlays" ? (
          <OverlaysScreen />
        ) : (
          <ListScreen />
        )}
      </PageTransition>
    </AppShell>
  );
}
