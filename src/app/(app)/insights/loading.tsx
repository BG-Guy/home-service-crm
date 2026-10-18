import { SkeletonPage } from "@/ui/components/SkeletonPage";

// Dashboard skeleton: KPI tiles first, then the list sections.
export default function Loading() {
  return <SkeletonPage stats={8} rows={5} />;
}
