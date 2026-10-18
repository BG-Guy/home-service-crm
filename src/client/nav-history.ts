// Navigation history for breadcrumbs: the pages this tab actually visited, in order,
// not the app's folder hierarchy. A page you return to cuts the trail back to it, so
// the trail reads like a stack: "Schedule › Jane Smith › J-1042". Kept per tab in
// sessionStorage and scoped to the signed-in user (another user in the same tab
// starts fresh). Pure helpers are exported for tests; the store is browser-only.

export interface Crumb {
  /** Pathname (no query): one crumb per page. */
  path: string;
  /** Last URL seen on that page (keeps its tab, filters, date). */
  href: string;
  /** The page's own title (NavBar / large title), when it has told us. */
  title: string | null;
}

const KEY = "crm.trail.v1";
const TITLES_KEY = "crm.trail-titles.v1";
const USER_KEY = "crm.trail-user.v1";
const MAX = 15;
const MAX_TITLES = 300;

/** "/jobs?mine=1#x" → "/jobs"; trailing slashes dropped. */
export function pathOf(href: string): string {
  const p = href.split(/[?#]/)[0] ?? "";
  return p.length > 1 ? p.replace(/\/+$/, "") : p || "/";
}

/**
 * Pages you pass through rather than return to: the "/" redirect to your home,
 * create forms, print views and one-shot flows. They drop out of the trail once
 * you leave them.
 */
export function isTransient(path: string): boolean {
  return (
    path === "/" ||
    /\/(new|print|merge|evidence|theft-report|finish|nacha)(\/|$)/.test(path)
  );
}

/** The trail after visiting `href` (pure). */
export function visit(
  trail: readonly Crumb[],
  href: string,
  title: string | null = null,
): Crumb[] {
  const path = pathOf(href);
  let next = [...trail];
  const last = next[next.length - 1];
  if (last && last.path !== path && isTransient(last.path)) next.pop();
  const at = findLastIndex(next, (c) => c.path === path);
  if (at >= 0) {
    next = next.slice(0, at + 1);
    const c = next[at] as Crumb;
    next[at] = { ...c, href, title: title ?? c.title };
  } else {
    next.push({ path, href, title });
  }
  return next.length > MAX ? next.slice(-MAX) : next;
}

/**
 * The crumbs before the page at `pathname`: what its back button and breadcrumbs
 * show. Works before the visit is recorded (the new page renders first).
 */
export function crumbsBefore(
  trail: readonly Crumb[],
  pathname: string,
): Crumb[] {
  const path = pathOf(pathname);
  const at = findLastIndex(trail, (c) => c.path === path);
  const before = at >= 0 ? trail.slice(0, at) : [...trail];
  return before.filter(
    (c, i) => !(isTransient(c.path) && i === before.length - 1),
  );
}

function findLastIndex<T>(list: readonly T[], fn: (t: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (fn(list[i] as T)) return i;
  return -1;
}

/* ------------------------------------------------------------------ store */

const EMPTY: readonly Crumb[] = [];
let trail: readonly Crumb[] = EMPTY;
let titles: Record<string, string> = {};
let loaded = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // blocked storage (private mode, sandboxed frame)
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  const s = storage();
  try {
    const t = JSON.parse(s?.getItem(KEY) ?? "[]");
    if (Array.isArray(t))
      trail = t.filter(
        (c): c is Crumb =>
          !!c && typeof c.path === "string" && typeof c.href === "string",
      );
    const n = JSON.parse(s?.getItem(TITLES_KEY) ?? "{}");
    if (n && typeof n === "object") titles = n;
  } catch {
    trail = EMPTY;
    titles = {};
  }
}

function save() {
  const s = storage();
  try {
    s?.setItem(KEY, JSON.stringify(trail));
    s?.setItem(TITLES_KEY, JSON.stringify(titles));
  } catch {
    /* quota or blocked: the trail just won't survive a reload */
  }
  for (const l of listeners) l();
}

export function subscribeTrail(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getTrail(): readonly Crumb[] {
  load();
  return trail;
}

export const getServerTrail = (): readonly Crumb[] => EMPTY;

/** Known title for a path (from an earlier visit), if any. */
export function titleOf(path: string): string | null {
  load();
  return titles[path] ?? null;
}

/** Start a fresh trail when a different user signs in to this tab. */
export function scopeTrailTo(userId: string): void {
  load();
  const s = storage();
  try {
    if (s?.getItem(USER_KEY) === userId) return;
    s?.setItem(USER_KEY, userId);
  } catch {
    return;
  }
  trail = EMPTY;
  titles = {};
  save();
}

export function recordVisit(href: string): void {
  load();
  const next = visit(trail, href, titles[pathOf(href)] ?? null);
  const same =
    next.length === trail.length &&
    next.every((c, i) => {
      const o = trail[i];
      return o && o.path === c.path && o.href === c.href && o.title === c.title;
    });
  if (same) return;
  trail = next;
  save();
}

/** A page names itself (its nav-bar title) so crumbs can show it. */
export function nameVisit(pathname: string, title: string): void {
  load();
  const path = pathOf(pathname);
  const t = title.trim();
  if (!t || titles[path] === t) return;
  titles[path] = t;
  const keys = Object.keys(titles);
  if (keys.length > MAX_TITLES)
    for (const k of keys.slice(0, keys.length - MAX_TITLES)) delete titles[k];
  trail = trail.map((c) => (c.path === path ? { ...c, title: t } : c));
  save();
}
