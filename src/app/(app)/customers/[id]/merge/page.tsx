import type { Metadata } from "next";
import { MergeTool } from "@/features/customers/components/MergeTool";
import { getCustomerDetail } from "@/features/customers/queries";
import { requireUser } from "@/lib/auth/current";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Merge customers" };

export default async function CustomersIdMergePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser("customers.merge");
  const c = await getCustomerDetail(id);
  return (
    <PageTransition>
      <NavBar
        title="Merge"
        back={{ href: `/customers/${id}`, label: c.displayName }}
      />
      <Page className="max-w-[640px] pt-4">
        <MergeTool current={{ id: c.id, displayName: c.displayName }} />
      </Page>
    </PageTransition>
  );
}
