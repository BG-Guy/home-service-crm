import { Mail, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReassignJobsList } from "@/features/jobs/slots";
import { ActivityTimeline } from "@/features/notify/slots";
import { TechCompSection } from "@/features/payroll/slots";
import { EditMemberButton } from "@/features/team/components/EditMemberButton";
import {
  AccessSection,
  StatusSection,
} from "@/features/team/components/MemberControls";
import {
  TimeOffSection,
  WorkHoursSection,
} from "@/features/team/components/MemberSchedule";
import {
  getOffboardingState,
  getTeamMember,
  listRoleOptions,
  listSkillOptions,
} from "@/features/team/queries";
import { workerTypeLabel } from "@/features/team/rules";
import { getMemberSchedule } from "@/features/team/schedule-queries";
import { TimeEntriesSection } from "@/features/time/slots";
import { ToolCustodyRow } from "@/features/tools/slots";
import { AssignedVehicleRow } from "@/features/vehicles/slots";
import { requireUser } from "@/lib/auth/current";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getCompanyTimezone } from "@/lib/settings";
import { ageOn, experienceLabel, tenureLabel } from "@/lib/tenure";
import { dateKey, formatDate, formatDateKey, formatRelative } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Team member" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team member profile (SPEC M02; BUILD_PLAN §5.3): profile, role and status,
// overrides link, S43 comp, S6 time, S50 vehicle, S51 tools, S33 timeline; after
// deactivation S7 reassign list and the cash-held flag.
export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireUser("users.manage");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [m, roles, skills, tz, schedule] = await Promise.all([
    getTeamMember(id),
    listRoleOptions(),
    listSkillOptions(),
    getCompanyTimezone(),
    getMemberSchedule(id),
  ]);
  if (!m) notFound();
  const deactivated = m.status === "deactivated";
  const isSelf = viewer.id === m.id;
  const offboarding = deactivated ? await getOffboardingState(m.id) : null;
  const tech = m.baseRole === "tech";
  const today = dateKey(new Date(), tz);
  const tenure = tenureLabel(m.hireDate, today);
  const age = ageOn(m.birthDate, today);
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

  return (
    <PageTransition>
      <NavBar
        title={m.name}
        back={{ href: "/team", label: "Team" }}
        trailing={
          deactivated ? undefined : (
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
                experienceYears: m.experienceYears,
                birthDate: m.birthDate,
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
            {!deactivated && (
              <div className="mt-2 flex justify-center gap-6">
                {m.phone && (
                  <QuickAction
                    href={`tel:${m.phone}`}
                    label="Call"
                    aria={`Call ${m.name}`}
                    icon={<Phone size={20} aria-hidden />}
                  />
                )}
                {m.phone && (
                  <QuickAction
                    href={`sms:${m.phone}`}
                    label="Text"
                    aria={`Text ${m.name}`}
                    icon={<MessageCircle size={20} aria-hidden />}
                  />
                )}
                <QuickAction
                  href={`mailto:${m.email}`}
                  label="Email"
                  aria={`Email ${m.name}`}
                  icon={<Mail size={20} aria-hidden />}
                />
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
                value: m.hireDate
                  ? `${formatDateKey(m.hireDate)}${tenure ? ` · ${tenure}` : ""}`
                  : "",
              },
              {
                key: "exp",
                label: "Experience",
                value: experienceLabel(m.experienceYears) ?? "",
              },
              // ⚖️ This page requires users.manage, the only role (with the member
              // themself) allowed to see the date of birth and age.
              {
                key: "dob",
                label: "Date of birth",
                value: m.birthDate
                  ? `${formatDateKey(m.birthDate)}${age != null ? ` · ${age}` : ""}`
                  : "",
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

          {/* Booking availability: when this tech takes jobs (leads-flow item 8). */}
          {tech && !deactivated && (
            <WorkHoursSection
              userId={m.id}
              firstName={m.name.split(" ")[0] || m.name}
              workHours={schedule.workHours}
              business={schedule.business}
            />
          )}
          {tech && !deactivated && (
            <TimeOffSection
              userId={m.id}
              firstName={m.name.split(" ")[0] || m.name}
              today={today}
              entries={schedule.timeOff.map((t) => ({
                id: t.id,
                label: t.label,
                note: t.note,
                allDay: t.allDay,
                current: t.current,
              }))}
            />
          )}

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

          {tech && <TechCompSection userId={m.id} />}
          {tech && <AssignedVehicleRow userId={m.id} />}
          {tech && <ToolCustodyRow userId={m.id} />}
          <TimeEntriesSection userId={m.id} days={14} />
          <ActivityTimeline entity={{ type: "user", id: m.id }} limit={20} />

          <StatusSection
            userId={m.id}
            name={m.name}
            deactivated={deactivated}
            awaitingApproval={m.status === "pending"}
            isSelf={isSelf}
          />
          <p className="px-4 text-center text-footnote text-label-3">
            Added {formatDate(m.createdAt, tz)}
          </p>
        </div>
      </Page>
    </PageTransition>
  );
}

/** Round labeled quick action (call / text / email) under the profile header. */
function QuickAction({
  href,
  label,
  aria,
  icon,
}: {
  href: string;
  label: string;
  aria: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={aria}
      className="pressable flex w-16 flex-col items-center gap-1.5 text-footnote font-medium text-accent-text"
    >
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-card text-accent-text shadow-card"
      >
        {icon}
      </span>
      {label}
    </a>
  );
}
