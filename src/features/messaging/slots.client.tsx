"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/ui/components/Skeleton";
import { loadComposer } from "./actions";
import { Composer } from "./components/Composer";
import type { ComposerData, MessageComposerProps } from "./contracts";

// Client UI slots produced by B5 (BUILD_PLAN §5.1). Client slots take serializable
// props and call only the producer's own actions.

/**
 * S29 — Channel/template picker, segment counter, consent warning. Calls the B5
 * `sendMessage` action (→ enqueueMessage); in link mode it hands off to an outbox
 * card right inside the composer. Pass `initial` (optional) to skip the data fetch.
 */
export function MessageComposer(
  props: MessageComposerProps & {
    initial?: ComposerData | null;
    autoFocus?: boolean;
  },
) {
  const [data, setData] = useState<ComposerData | null>(props.initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const key = props.templateKeys?.join(",") ?? "";

  useEffect(() => {
    if (props.initial) return;
    let alive = true;
    loadComposer({
      customerId: props.customerId,
      jobId: props.jobId,
      leadId: props.leadId,
      templateKeys: key ? key.split(",") : undefined,
    }).then((res) => {
      if (!alive) return;
      if (res.ok && res.data) setData(res.data);
      else setError(res.ok ? "Unavailable" : res.error);
    });
    return () => {
      alive = false;
    };
  }, [props.customerId, props.jobId, props.leadId, props.initial, key]);

  if (error)
    return (
      <p className="px-1 text-footnote text-label-2">
        Messaging isn&apos;t available here.
      </p>
    );
  if (!data)
    return <Skeleton height={props.compact ? 120 : 180} rounded="card" />;
  return (
    <Composer
      data={data}
      jobId={props.jobId}
      leadId={props.leadId}
      defaultChannel={props.defaultChannel}
      compact={props.compact}
      autoFocus={props.autoFocus}
    />
  );
}
