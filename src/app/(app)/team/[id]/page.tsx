import {
  BadgeDollarSign,
  BarChart3,
  Briefcase,
  CalendarDays,
  Clock,
  Mail,
  Phone,
  Settings,
  Star,
  Sun,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ReassignJobsList } from "@/features/jobs/slots";
import { ActivityTimeline } from "@/features/notify/slots";
import { TechCompSection } from "@/features/payroll/slots";
import { EditMemberButton } from "@/features/team/components/EditMemberSheet";
import {
  AccessSection,
  StatusSection,
} from "@/features/team/components/MemberControls";
import {
  getOffboardingState,
  getTeamMember,
  listRoleOptions,
  listSkillOptions,
} from "@/features/team/queries";
import { workerTypeLabel } from "@/features/team/rules";
import { TimeEntriesSection } from "@/features/time/slots";
import { ToolCustodyRow } from "@/features/tools/slots";
import { AssignedVehicleRow } from "@/features/vehicles/slots";
import { requireUser } from "@/lib/auth/current";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDate, formatDateKey, formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";
import type { Tone } from "@/ui/tone";

export const metadata: Metadata = { title: "Profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team member profile (SPEC M02; BUILD_PLAN §5.3): profile, role and status,
// overrides link, S43 comp, S6 time, S50 vehicle, S51 tools, S33 timeline; after
// deactivation S7 reassign list and the cash-held flag.
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // Your own profile is open to everyone (the sidebar's profile row leads here);
  // anyone else's needs users.manage.
  const manage = viewer.perms.has("users.manage");
  if (!manage && viewer.id !== id) await requireUser("users.manage");
  const [m, roles, skills, tz] = await Promise.all([
    getTeamMember(id),
    listRoleOptions(),
    listSkillOptions(),
    getCompanyTimezone(),
  ]);
  if (!m) notFound();
  const deactivated = m.status === "deactivated";
  const isSelf = viewer.id === m.id;
  const offboarding = deactivated ? await getOffboardingState(m.id) : null;
  const tech = m.baseRole === "tech";
  const skillNames = skills
    .filter((s) => m.skills.includes(s.id))
    .map((s) => s.name);
  const home = m.homeBase
    ? [m.homeBase.street, m.homeBase.city, m.homeBase.state, m.homeBase.zip]
        .filter(Boolean)
        .join(", ")
    : "";
  const roleOptions = roles.filter(
    (r) =>
      viewer.perms.has("settings.permissions") ||
      r.baseRole !== "admin" ||
      r.key === m.role,
  );

  // The worker's dashboard: where their work lives, as far as the viewer may go.
  const has = (perm: Parameters<typeof viewer.perms.has>[0]) =>
    viewer.perms.has(perm);
  const work: {
    key: string;
    title: string;
    href: string;
    icon: ReactNode;
    tone: Tone;
  }[] = [];
  const link = (
    when: boolean,
    key: string,
    title: string,
    href: string,
    icon: ReactNode,
    tone: Tone,
  ) => {
    if (when) work.push({ key, title, href, icon, tone });
  };
  if (!deactivated) {
    link(isSelf, "today", "My day", "/today", <Sun size={17} />, "orange");
    link(
      has("schedule.view_all") && tech,
      "schedule",
      isSelf ? "My schedule" : "Schedule",
      `/schedule?view=day&tech=${m.id}`,
      <CalendarDays size={17} />,
      "red",
    );
    link(
      isSelf || has("jobs.view_all"),
      "jobs",
      isSelf ? "My jobs" : "Jobs",
      isSelf && !has("jobs.view_all") ? "/jobs?mine=1" : `/jobs?tech=${m.id}`,
      <Briefcase size={17} />,
      "blue",
    );
    link(
      isSelf && tech && has("insights.view_own"),
      "stats",
      "My stats",
      "/insights?view=me",
      <BarChart3 size={17} />,
      "purple",
    );
    link(
      !isSelf && tech && has("reviews.view"),
      "reviews",
      "Reviews",
      `/reviews?tech=${m.id}`,
      <Star size={17} />,
      "yellow",
    );
    link(
      isSelf && has("payroll.view_own"),
      "pay",
      "My pay",
      "/pay",
      <BadgeDollarSign size={17} />,
      "green",
    );
    link(
      isSelf ? has("time.clock_self") : has("time.manage"),
      "time",
      isSelf ? "My time" : "Time",
      isSelf ? "/time" : `/time?user=${m.id}`,
      <Clock size={17} />,
      "teal",
    );
    link(
      tech &&
        (isSelf
          ? has("tools.view_own") || has("tools.view_all")
          : has("tools.view_all")),
      "tools",
      isSelf ? "My tools" : "Tools",
      has("tools.view_all") ? `/tools?scope=all&holder=${m.id}` : "/tools",
      <Wrench size={17} />,
      "brown",
    );
    link(
      isSelf,
      "account",
      "Account settings",
      "/settings/profile",
      <Settings size={17} />,
      "gray",
    );
  }

  return (
    <PageTransition>
      <NavBar
        title={m.name}
        back={
          manage
            ? { href: "/team", label: "Team" }
            : { href: "/more", label: "More" }
        }
        trailing={
          !manage ? (
            <Button href="/settings/profile" variant="plain" size="sm">
              Edit
            </Button>
          ) : deactivated ? undefined : (
            <EditMemberButton
              skills={skills}
              member={{
                id: m.id,
                name: m.name,
                email: m.email,
                phone: m.phone,
                color: m.color,
                avatarUrl: m.avatarUrl,
                hireDate: m.hireDate,
                workerType: m.workerType,
                baseRole: m.baseRole,
                usesCompanyTools: m.usesCompanyTools,
                usesCompanyVehicle: m.usesCompanyVehicle,
                serviceZips: m.serviceZips,
                skills: m.skills,
                licenses: m.licenseNumbers,
                homeBase: m.homeBase,
              }}
            />
          )
        }
      />
      <Page className="pt-5">
        <div className="flex flex-col gap-[var(--section-gap)]">
          <header className="flex flex-col items-center gap-2 text-center">
            <Avatar
              name={m.name}
              src={m.avatarUrl}
              seed={m.id}
              size={88}
              className={deactivated ? "opacity-50 grayscale" : undefined}
            />
            <div>
              <h1 className="text-title2 font-bold">{m.name}</h1>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <Pill
                  tone={
                    m.baseRole === "admin"
                      ? "indigo"
                      : m.baseRole === "office"
                        ? "blue"
                        : "orange"
                  }
                  size="sm"
                >
                  {m.roleName}
                </Pill>
                {tech && (
                  <Pill tone="gray" size="sm" dot={false}>
                    {workerTypeLabel(m.workerType)}
                  </Pill>
                )}
                {deactivated ? (
                  <Pill tone="gray" size="sm">
                    Deactivated
                  </Pill>
                ) : m.status !== "active" ? (
                  <Pill tone="blue" size="sm">
                    {m.status === "pending"
                      ? "Waiting for approval"
                      : "Invited"}
                  </Pill>
                ) : null}
              </div>
            </div>
            {!deactivated && !isSelf && (
              <div className="mt-1 flex gap-3">
                {m.phone && (
                  <IconButton
                    href={`tel:${m.phone}`}
                    label={`Call ${m.name}`}
                    variant="gray"
                    transition="none"
                  >
                    <Phone size={18} aria-hidden />
                  </IconButton>
                )}
                <IconButton
                  href={`mailto:${m.email}`}
                  label={`Email ${m.name}`}
                  variant="gray"
                  transition="none"
                >
                  <Mail size={18} aria-hidden />
                </IconButton>
              </div>
            )}
          </header>

          {deactivated && offboarding && (
            <div className="flex flex-col gap-3">
              <Banner tone="offline" title="Deactivated">
                {m.deactivatedAt
                  ? `Since ${formatDate(m.deactivatedAt, tz)}. `
                  : ""}
                Signed out everywhere; can't sign in. History, jobs and pay
                records are kept.
              </Banner>
              {offboarding.cashHeldCents > 0 && (
                <Banner tone="warning" title="Still holding company money">
                  <MoneyText cents={offboarding.cashHeldCents} /> in cash and
                  checks
                  {offboarding.cashOldestAt
                    ? `, oldest ${formatRelative(
                        Math.min(
                          new Date(offboarding.cashOldestAt).getTime(),
                          Date.now(),
                        ),
                      )}`
                    : ""}
                  . Collect it and record the remittance on Pay.
                </Banner>
              )}
              {offboarding.openJobs > 0 && <ReassignJobsList userId={m.id} />}
            </div>
          )}

          {work.length > 0 && (
            <ListSection header={isSelf ? "Your work" : "Work"}>
              {work.map((w) => (
                <ListRow
                  key={w.key}
                  href={w.href}
                  icon={w.icon}
                  iconTone={w.tone}
                  title={w.title}
                />
              ))}
            </ListSection>
          )}

          <KeyValueList
            items={[
              {
                key: "email",
                label: "Email",
                value: m.email,
                href: `mailto:${m.email}`,
              },
              {
                key: "phone",
                label: "Mobile",
                value: formatPhoneDisplay(m.phone),
                href: m.phone ? `tel:${m.phone}` : undefined,
              },
              ...(m.color
                ? [
                    {
                      key: "color",
                      label: "Calendar color",
                      value: (
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-3.5 rounded-full"
                            style={{ background: m.color }}
                          />
                          {m.color.toUpperCase()}
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                key: "hire",
                label: "Hire date",
                value: m.hireDate ? formatDateKey(m.hireDate) : "",
              },
              {
                key: "login",
                label: "Last sign-in",
                value: m.lastLoginAt ? formatRelative(m.lastLoginAt) : "Never",
              },
            ]}
          />

          {(tech || m.licenseNumbers.length > 0) && (
            <ListSection header="Field profile">
              <KeyValueList
                card={false}
                items={[
                  {
                    key: "lic",
                    label: "Licenses",
                    stacked: m.licenseNumbers.length > 0,
                    value: m.licenseNumbers.length
                      ? m.licenseNumbers
                          .map(
                            (l) =>
                              `${l.state} ${l.trade} #${l.number}${l.expires_on ? ` (exp. ${formatDateKey(l.expires_on)})` : ""}`,
                          )
                          .join("\n")
                      : "",
                  },
                  {
                    key: "skills",
                    label: "Skills",
                    stacked: skillNames.length > 2,
                    value: skillNames.join(", "),
                  },
                  {
                    key: "zips",
                    label: "Service ZIPs",
                    stacked: m.serviceZips.length > 3,
                    value: m.serviceZips.join(", ") || "Whole area",
                  },
                  {
                    key: "home",
                    label: "Home base",
                    stacked: true,
                    value: home,
                  },
                  {
                    key: "tools",
                    label: "Company tools",
                    value: m.usesCompanyTools ? "Yes" : "No",
                  },
                  {
                    key: "veh",
                    label: "Vehicle",
                    value: m.usesCompanyVehicle ? "Company" : "Own (mileage)",
                  },
                  {
                    key: "notice",
                    label: "Monitoring notice",
                    value: m.monitoringNoticeAckAt
                      ? `Accepted ${formatDate(m.monitoringNoticeAckAt, tz)}`
                      : "Not accepted",
                  },
                ]}
              />
            </ListSection>
          )}

          {manage && (
            <AccessSection
              userId={m.id}
              name={m.name}
              role={{
                key: m.role,
                name: m.roleName,
                baseRole: m.baseRole,
              }}
              roles={roleOptions}
              overrideCount={m.overrideCount}
              canPermissions={viewer.perms.has("settings.permissions")}
              isSelf={isSelf}
              deactivated={deactivated}
            />
          )}

          {tech && <TechCompSection userId={m.id} />}
          {tech && <AssignedVehicleRow userId={m.id} />}
          {tech && <ToolCustodyRow userId={m.id} />}
          <TimeEntriesSection userId={m.id} days={14} />
          <ActivityTimeline entity={{ type: "user", id: m.id }} limit={20} />

          {manage && (
            <StatusSection
              userId={m.id}
              name={m.name}
              deactivated={deactivated}
              awaitingApproval={m.status === "pending"}
              isSelf={isSelf}
            />
          )}
          <p className="px-4 text-center text-footnote text-label-3">
            Added {formatDate(m.createdAt, tz)}
          </p>
        </div>
      </Page>
    </PageTransition>
  );
}
