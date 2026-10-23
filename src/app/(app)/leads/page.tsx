import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  LEAD_COLS_COOKIE,
  parseInboxShow,
  parseLeadCols,
} from "@/features/leads/components/inbox-prefs";
import {
  LeadsInbox,
  leadFilterFrom,
} from "@/features/leads/components/LeadsInbox";
import { getLeadsMapData } from "@/features/leads/map-queries";
import { requireUser } from "@/lib/auth/current";
import { isEnabled } from "@/lib/settings";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("leads.view");
  if (!(await isEnabled("leads"))) notFound();
  // The lead map's pins and today's jobs: started now, read by the map when it
  // shows (desktop column, phone Map mode). A failure leaves the inbox as is.
  const map = getLeadsMapData(user).catch((err: unknown) => {
    console.error("[leads] map data failed:", err);
    return null;
  });
  const sp = await searchParams;
  const jar = await cookies();
  const show = Array.isArray(sp.show) ? sp.show[0] : sp.show;
  return (
    <PageTransition>
      <LeadsInbox
        filter={leadFilterFrom(sp)}
        viewer={user}
        cols={parseLeadCols(jar.get(LEAD_COLS_COOKIE)?.value)}
        show={parseInboxShow(show)}
        map={map}
      />
    </PageTransition>
  );
}
