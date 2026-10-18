"use client";

import dynamic from "next/dynamic";

// Client UI slots produced by B5 (BUILD_PLAN §5.1). Client slots take serializable
// props and call only the producer's own actions.

/** S36 — Subscribe to push from a user gesture. */
export type PushEnableButtonProps = { label?: string };

// Push helpers load only where the button is shown.
const PushButton = dynamic(
  () => import("./components/PushButton").then((m) => m.PushButton),
  { ssr: false },
);

export function PushEnableButton(props: PushEnableButtonProps) {
  return <PushButton {...props} />;
}
