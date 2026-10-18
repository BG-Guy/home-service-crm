import { getCompanyTimezone } from "@/lib/settings";
import { formatRelative, formatTime } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { ListRow } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill } from "@/ui/components/StatusPill";
import type { TeamMemberRow } from "../queries";
import { workerTypeLabel } from "../rules";

/** One team-list row (server): avatar + presence, role · worker type · clock, cash and flags. */
export async function TeamRow({
  m,
  linkable,
}: {
  m: TeamMemberRow;
  linkable: boolean;
}) {
  const tz = await getCompanyTimezone();
  const bits = [m.roleName];
  if (m.baseRole === "tech") bits.push(workerTypeLabel(m.workerType));
  if (m.clockedInSince)
    bits.push(`In since ${formatTime(m.clockedInSince, tz)}`);
  else if (m.status === "active" && m.lastLoginAt)
    bits.push(`Seen ${formatRelative(m.lastLoginAt)}`);
  else if (m.status === "active" && !m.lastLoginAt)
    bits.push("Never signed in");
  const flags: { label: string; tone: "orange" | "red" | "gray" }[] = [];
  if (m.status === "deactivated")
    flags.push({ label: "Deactivated", tone: "gray" });
  if (m.status === "pending")
    flags.push({ label: "Needs approval", tone: "orange" });
  if (m.agreementUnsigned) flags.push({ label: "Agreement", tone: "orange" });
  if (m.toolAuditOverdue) flags.push({ label: "Tool audit", tone: "red" });
  const cash = m.cashHeldCents ?? 0;
  return (
    <ListRow
      leading={
        <Avatar
          name={m.name}
          src={m.avatarUrl}
          seed={m.id}
          size={40}
          status={
            m.status !== "active"
              ? undefined
              : m.clockedInSince
                ? "online"
                : "offline"
          }
        />
      }
      sepInset={68}
      title={m.name}
      subtitle={bits.join(" · ")}
      detail={
        cash > 0 || flags.length ? (
          <span className="flex items-center gap-1.5">
            {flags.map((f) => (
              <Pill key={f.label} tone={f.tone} size="sm">
                {f.label}
              </Pill>
            ))}
            {cash > 0 && (
              <span className="text-subhead" title="Cash and checks held">
                <span className="sr-only">Holding </span>
                <MoneyText cents={cash} compactWhole />
              </span>
            )}
          </span>
        ) : undefined
      }
      href={linkable ? `/team/${m.id}` : undefined}
    />
  );
}
