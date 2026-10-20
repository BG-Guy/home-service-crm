import { type ReactNode, ViewTransition } from "react";

/**
 * Shared-element morph (docs/DESIGN.md §4 M3): wrap the same thing on both screens
 * (a list row's title, avatar or status, and the detail hero's) with the same
 * `name`; on navigation it flies from one position and size to the other in
 * 400 ms on `--ease-spring`, on top of the M1 push / pop of the pages.
 *
 * ```tsx
 * // list row
 * <Morph name={`job-${job.id}-title`}><span>{job.title}</span></Morph>
 * // detail hero
 * <Morph name={`job-${job.id}-title`}><h1>{job.title}</h1></Morph>
 * ```
 *
 * - `name` must be unique on a page (two rows with one name break the transition).
 *   Build it from the record id plus the part: `job-<id>-title`, `cust-<id>-avatar`.
 * - The child must be one element (React names the first DOM node it renders).
 *   Inline text morphs best inside an inline-block element.
 * - It pairs only when the destination renders in the same commit as the
 *   navigation: a router-cache hit (every pop back to a list within 30 s, a revisit),
 *   a route without `loading.tsx`, or a link with `prefetch`. When the destination
 *   shows its `loading.tsx` skeleton first, nothing pairs and the element simply
 *   arrives with its page (no error, no flash).
 * - `default="none"` keeps it still during unrelated transitions (tab switches,
 *   refreshes); reduced motion turns the morph into a 150 ms cross-fade.
 */
export function Morph({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition name={name} share="morph" default="none">
      {children}
    </ViewTransition>
  );
}
