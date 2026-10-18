import { SkeletonPage } from "@/ui/components/Skeleton";

// Settings pages: header + grouped list placeholder while the page loads.
export default function Loading() {
  return <SkeletonPage rows={7} />;
}
