import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { reviewAudit } from "@/features/tools/actions";
import { AuditChecklist } from "@/features/tools/components/AuditChecklist";
import { getAudit } from "@/features/tools/queries";
import { ActionButton } from "@/features/vehicles/components/ActionButton";
import { requireAnyPerm } from "@/lib/auth/current";
import { personHref } from "@/lib/links";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { ListRow, ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Tool check" };

export default async function ToolAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPerm([
    "tools.audit_submit",
    "tools.audit_review",
  ]);
  if (!(await isEnabled("tools"))) notFound();
  const { id } = await params;
  const { audit, items, mine } = await getAudit(id);
  const open = audit.status === "scheduled" || audit.status === "in_progress";
  return (
    <PageTransition>
      <NavBar
        title="Tool check"
        back={{ href: mine ? "/tools?scope=mine" : "/tools", label: "Tools" }}
        trailing={
          !mine && audit.status === "submitted" ? (
            <ActionButton
              action={reviewAudit}
              input={{ auditId: audit.id }}
              variant="tinted"
              success="Marked reviewed"
            >
              Mark reviewed
            </ActionButton>
          ) : undefined
        }
      />
      <Page className="pt-4">
        <div className="flex flex-col gap-[var(--section-gap)]">
          <section className="list-card flex flex-col gap-1 p-4">
            <p className="text-headline">
              {mine ? (
                "Your tool check"
              ) : (
                <TextLink href={personHref(user, audit.userId)}>
                  {audit.userName}
                </TextLink>
              )}
            </p>
            <p className="text-subhead text-label-2">
              Due{" "}
              {formatDateKey(audit.dueOn, "en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}{" "}
              · {items.length} tool
              {items.length === 1 ? "" : "s"}
            </p>
            <div className="pt-1">
              <StatusPill kind="toolAudit" status={audit.status} size="sm" />
            </div>
          </section>
          {mine && open ? (
            <AuditChecklist auditId={audit.id} items={items} />
          ) : (
            <ListSection header="Checklist">
              {items.map((i) => (
                <ListRow
                  key={i.id}
                  multiline
                  href={i.canOpen ? `/tools/${i.toolId}` : undefined}
                  leading={
                    i.photoUrl ? (
                      // biome-ignore lint/performance/noImgElement: signed storage thumbnail
                      <img
                        src={i.photoUrl}
                        alt={`${i.name} at the check`}
                        width={44}
                        height={44}
                        className="size-11 rounded-[10px] object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="size-11 rounded-[10px] bg-fill-2"
                      />
                    )
                  }
                  title={i.name}
                  subtitle={[
                    i.assetTag,
                    i.serial && `S/N ${i.serial}`,
                    i.condition,
                    i.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  detail={
                    i.present === true ? (
                      <Pill tone="green" size="sm">
                        <Check size={12} aria-hidden /> Present
                      </Pill>
                    ) : i.present === false ? (
                      <Pill tone="red" size="sm">
                        <X size={12} aria-hidden /> Missing
                      </Pill>
                    ) : (
                      <Pill tone="gray" size="sm">
                        Not checked
                      </Pill>
                    )
                  }
                />
              ))}
            </ListSection>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
