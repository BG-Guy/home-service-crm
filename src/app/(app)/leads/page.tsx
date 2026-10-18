import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  LeadsPane,
  leadFilterFrom,
} from "@/features/leads/components/LeadsPane";
import { requireUser } from "@/lib/auth/current";
import { isEnabled } from "@/lib/settings";
import { SplitView } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("leads.view");
  if (!(await isEnabled("leads"))) notFound();
  const filter = leadFilterFrom(await searchParams);
  return (
    <PageTransition>
      <SplitView
        showDetail={false}
        list={<LeadsPane filter={filter} viewer={user} />}
        detail={
          <div className="flex h-dvh items-center justify-center">
            <EmptyState
              icon={<Inbox size={48} strokeWidth={1.5} />}
              title="Select a lead"
              message="Answer new leads within 5 minutes. The timer on each card shows how long they've waited."
            />
          </div>
        }
      />
    </PageTransition>
  );
}
