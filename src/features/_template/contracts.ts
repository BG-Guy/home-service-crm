// Types other modules (and client components) may import: props of the UI slots you
// produce and DTOs of your api.ts functions (BUILD_PLAN §5–§6). Types only — no runtime.

export interface ExampleItem {
  id: string;
  title: string;
  done: boolean;
  /** ISO timestamp (DTOs crossing to the client use strings, not Date). */
  dueAt: string | null;
}

/** Props of a slot this module would expose, e.g. <ExampleCount userId=… />. */
export type ExampleCountProps = { userId: string };
