import { Hammer } from "lucide-react";
import { EmptyState } from "@/ui/components/EmptyState";

/** Placeholder for a customer-facing page until its owner builds it. */
export function PublicComingSoon({
  title,
  owner,
}: {
  title: string;
  owner: string;
}) {
  return (
    <div className="list-card mt-4">
      <EmptyState
        icon={<Hammer size={44} strokeWidth={1.6} />}
        title={title}
        message={`Coming soon — owned by ${owner}.`}
      />
    </div>
  );
}
