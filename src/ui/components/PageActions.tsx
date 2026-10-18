"use client";

import Link from "next/link";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";

/*
 * Desktop action rail (≥ 1024 px): a page's actions ("Reschedule or reassign",
 * "Cancel job"…) stand in a column right next to the sidebar, like a second level
 * of it, instead of hiding behind a "…" button. Phones and tablets keep the "…"
 * action sheet.
 *
 * - A page wraps its content in `<ActionRailFrame>`. The frame reserves the rail
 *   column while rendering on the server, so nothing shifts when it fills in.
 * - Any component inside — a nav-bar menu, an in-page action bar — publishes its
 *   actions with `usePageActions()`, which returns `true` when a rail shows them
 *   (hide your "…" trigger at `lg` then, e.g. `className="lg:hidden"`).
 */

export interface PageAction {
  label: string;
  /** Two short words for the compact rail (default: `label`). */
  short?: string;
  /** A lucide icon at 18–20 px. */
  icon?: ReactNode;
  onSelect?: () => void;
  /** Navigate instead (push transition). */
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
}

export interface PageActionGroup {
  title?: string;
  actions: readonly PageAction[];
}

export interface PageActionsSpec {
  /** Rail header, e.g. the job number. */
  title?: string;
  /** Second header line, e.g. "Job actions". */
  subtitle?: string;
  groups: readonly PageActionGroup[];
}

interface Registry {
  set(id: string, spec: PageActionsSpec | null): void;
}

const RegistryContext = createContext<Registry | null>(null);

/**
 * Publish this component's actions to the page's rail (desktop). Returns `true`
 * when a rail is showing them, so the caller can hide its own "…" at `lg`.
 * Handlers may change every render; the rail always calls the latest.
 */
export function usePageActions(spec: PageActionsSpec | null): boolean {
  const registry = use(RegistryContext);
  const id = useId();
  const latest = useRef(spec);
  latest.current = spec;
  // Re-register only when what the rail shows changes, not on every render.
  const shape = spec
    ? JSON.stringify([
        spec.title,
        spec.subtitle,
        spec.groups.map((g) => [
          g.title,
          g.actions.map((a) => [
            a.label,
            a.short,
            a.href,
            !!a.destructive,
            !!a.disabled,
          ]),
        ]),
      ])
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shape` stands for `spec`
  useLayoutEffect(() => {
    if (!registry) return;
    const s = latest.current;
    registry.set(
      id,
      s
        ? {
            ...s,
            groups: s.groups.map((g, gi) => ({
              ...g,
              actions: g.actions.map((a, ai) => ({
                ...a,
                // Call through the ref: the latest handler, without re-registering.
                onSelect: a.onSelect
                  ? () => latest.current?.groups[gi]?.actions[ai]?.onSelect?.()
                  : undefined,
              })),
            })),
          }
        : null,
    );
  }, [registry, id, shape]);
  // Unregister on unmount.
  useLayoutEffect(() => () => registry?.set(id, null), [registry, id]);
  return !!registry && !!spec && spec.groups.some((g) => g.actions.length);
}

/**
 * Lays a page out as [rail | content] on desktop and hosts the rail. Use it on
 * pages that have actions; `compact` gives the icon-over-label rail (pages that
 * already have a list column, like the customer and lead split views).
 */
export function ActionRailFrame({
  children,
  compact,
  enabled = true,
  className,
}: {
  children: ReactNode;
  compact?: boolean;
  /** `false` renders the children as they are (no rail, "…" menus stay). */
  enabled?: boolean;
  className?: string;
}) {
  const [specs, setSpecs] = useState<ReadonlyMap<string, PageActionsSpec>>(
    () => new Map(),
  );
  const set = useCallback((id: string, spec: PageActionsSpec | null) => {
    setSpecs((prev) => {
      if (!spec && !prev.has(id)) return prev;
      const next = new Map(prev);
      if (spec) next.set(id, spec);
      else next.delete(id);
      return next;
    });
  }, []);
  const registry = useMemo<Registry>(() => ({ set }), [set]);
  const list = [...specs.values()];
  const title = list.find((s) => s.title)?.title;
  const subtitle = list.find((s) => s.subtitle)?.subtitle;
  // Two sources may offer the same action (the job menu and the on-site dock
  // both have "Cancel job"): the first one wins.
  const seen = new Set<string>();
  const groups = list
    .flatMap((s) => s.groups)
    .map((g) => ({
      ...g,
      actions: g.actions.filter((a) => {
        if (seen.has(a.label)) return false;
        seen.add(a.label);
        return true;
      }),
    }))
    .filter((g) => g.actions.length);

  if (!enabled) return <>{children}</>;
  return (
    <RegistryContext value={registry}>
      <div
        className={cx("action-frame", className)}
        data-compact={compact || undefined}
      >
        <ActionRail
          title={title}
          subtitle={subtitle}
          groups={groups}
          compact={compact}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </RegistryContext>
  );
}

function ActionRail({
  title,
  subtitle,
  groups,
  compact,
}: {
  title?: string;
  subtitle?: string;
  groups: readonly PageActionGroup[];
  compact?: boolean;
}) {
  const plain = groups.filter((g) => !g.actions.every((a) => a.destructive));
  const danger = groups.filter((g) => g.actions.every((a) => a.destructive));
  return (
    <aside
      data-chrome
      aria-label={title ? `${title} actions` : "Page actions"}
      className="action-rail"
    >
      {(title || subtitle) && (
        <div className="action-rail-head">
          {title && <p className="truncate text-headline">{title}</p>}
          {subtitle && (
            <p className="truncate text-footnote text-label-2">{subtitle}</p>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4">
        {plain.map((g, i) => (
          <RailGroup key={g.title ?? i} group={g} compact={compact} />
        ))}
        {danger.length > 0 && (
          <div className="mt-auto flex flex-col gap-4">
            {danger.map((g, i) => (
              <RailGroup key={g.title ?? `d${i}`} group={g} compact={compact} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function RailGroup({
  group,
  compact,
}: {
  group: PageActionGroup;
  compact?: boolean;
}) {
  const headId = useId();
  return (
    <section aria-labelledby={group.title ? headId : undefined}>
      {group.title && (
        <h2 id={headId} className="action-rail-group">
          {group.title}
        </h2>
      )}
      <ul className="flex flex-col gap-0.5">
        {group.actions.map((a) => (
          <li key={a.label}>
            <RailItem action={a} compact={compact} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RailItem({
  action: a,
  compact,
}: {
  action: PageAction;
  compact?: boolean;
}) {
  const inner = (
    <>
      {a.icon && (
        <span aria-hidden className="action-rail-icon">
          {a.icon}
        </span>
      )}
      <span className="action-rail-label">
        <span className="action-rail-long">{a.label}</span>
        <span className="action-rail-short">{a.short ?? a.label}</span>
      </span>
    </>
  );
  const cls = cx("action-rail-item", a.destructive && "is-destructive");
  // In the compact rail the visible text is the short label; keep the full one
  // as the accessible name and tooltip.
  const named = compact && a.short && a.short !== a.label;
  if (a.href && !a.disabled)
    return (
      <Link
        href={a.href}
        transitionTypes={["nav-forward"]}
        className={cls}
        title={a.label}
        aria-label={named ? a.label : undefined}
      >
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      className={cls}
      disabled={a.disabled}
      title={a.label}
      aria-label={named ? a.label : undefined}
      onClick={a.onSelect}
    >
      {inner}
    </button>
  );
}
