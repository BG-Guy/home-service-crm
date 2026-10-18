/**
 * Screen titles known to the shell (from the module nav manifests), so a
 * `loading.tsx` skeleton can show the real large title, or the back button of a
 * pushed screen, before the page arrives (QA T4-25). Pure; client and server.
 */
export interface NavTitle {
  href: string;
  label: string;
}

/** "/jobs?mine=1" → "/jobs"; trailing slashes dropped. */
export function pathOf(href: string): string {
  const p = href.split(/[?#]/)[0] ?? "";
  return p.length > 1 ? p.replace(/\/+$/, "") : p || "/";
}

/** The title of the screen at exactly `pathname` (first match wins). */
export function titleForPath(
  titles: readonly NavTitle[],
  pathname: string,
): string | undefined {
  const path = pathOf(pathname);
  return titles.find((t) => pathOf(t.href) === path)?.label;
}

/**
 * The nearest ancestor screen of `pathname` (e.g. "/customers" for
 * "/customers/abc/edit"): the back target of a pushed screen.
 */
export function backForPath(
  titles: readonly NavTitle[],
  pathname: string,
): NavTitle | undefined {
  const path = pathOf(pathname);
  let best: NavTitle | undefined;
  let bestLen = -1;
  for (const t of titles) {
    const p = pathOf(t.href);
    if (p === "/" || p === path || !path.startsWith(`${p}/`)) continue;
    if (p.length > bestLen) {
      best = { href: p, label: t.label };
      bestLen = p.length;
    }
  }
  return best;
}

/** De-duplicate by path, keeping the first label (callers list the best source first). */
export function uniqueTitles(titles: readonly NavTitle[]): NavTitle[] {
  const seen = new Set<string>();
  const out: NavTitle[] = [];
  for (const t of titles) {
    const p = pathOf(t.href);
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ href: p, label: t.label });
  }
  return out;
}
