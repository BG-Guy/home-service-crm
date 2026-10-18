"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { Skeleton } from "@/ui/components/Skeleton";
import type { BoardData } from "../../schedule-queries";

// Loads the drag-and-drop board only on desktop widths (≥ 1024 px); phones get
// the server-rendered list instead, so they never download this chunk.

const BoardGrid = dynamic(() => import("./BoardGrid"), {
  ssr: false,
  loading: () => <Skeleton height={480} rounded="card" />,
});

const QUERY = "(min-width: 1024px)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function DesktopBoard({
  data,
  colorBy,
}: {
  data: BoardData;
  colorBy: "status" | "tech";
}) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  if (!desktop) return null;
  return <BoardGrid data={data} colorBy={colorBy} />;
}
