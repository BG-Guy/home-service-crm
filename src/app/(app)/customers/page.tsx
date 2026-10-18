import { Users } from "lucide-react";
import type { Metadata } from "next";
import {
  CustomersPane,
  filterFromSearchParams,
} from "@/features/customers/components/CustomersPane";
import { requireUser } from "@/lib/auth/current";
import { SplitView } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("customers.view");
  const filter = filterFromSearchParams(await searchParams);
  return (
    <PageTransition>
      <SplitView
        showDetail={false}
        list={<CustomersPane filter={filter} viewer={user} />}
        detail={
          <div className="flex h-dvh items-center justify-center">
            <EmptyState
              icon={<Users size={48} strokeWidth={1.5} />}
              title="Select a customer"
              message="Search by name, phone number, street or job number."
            />
          </div>
        }
      />
    </PageTransition>
  );
}
