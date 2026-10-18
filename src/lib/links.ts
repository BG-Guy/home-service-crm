// Where references to people and places lead, so names, avatars and addresses
// across the app are links that make sense for the viewer. Pure; client and server.

export interface LinkViewer {
  id: string;
  perms: { has(perm: string): boolean };
}

/**
 * A teammate (tech, assignee, author): their profile for people who manage the
 * team and for themselves; otherwise, for dispatchers, their day on the schedule.
 * `null` when the viewer has nowhere useful to go (show plain text).
 */
export function personHref(
  viewer: LinkViewer,
  userId: string | null | undefined,
  opts: { date?: string | null } = {},
): string | null {
  if (!userId) return null;
  if (userId === viewer.id || viewer.perms.has("users.manage"))
    return `/team/${userId}`;
  if (viewer.perms.has("schedule.view_all")) {
    const q = new URLSearchParams({ view: "day", tech: userId });
    if (opts.date) q.set("date", opts.date);
    return `/schedule?${q}`;
  }
  return null;
}

export interface MapsTarget {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  /** A one-line address, used when the parts aren't available. */
  full?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Directions deep link: Apple Maps on Apple devices, Google Maps elsewhere.
 * Prefers coordinates; `null` without an address or coordinates. Never call it
 * for an address that is masked for the viewer.
 */
export function mapsHref(
  p: MapsTarget,
  userAgent: string | null | undefined,
): string | null {
  const line =
    p.full?.trim() ||
    [p.street, p.city, [p.state, p.zip].filter(Boolean).join(" ")]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(", ");
  const hasPoint = p.lat != null && p.lng != null;
  if (!line && !hasPoint) return null;
  const q = encodeURIComponent(line);
  if (/iPhone|iPad|iPod|Macintosh/i.test(userAgent ?? "")) {
    if (!hasPoint) return `https://maps.apple.com/?daddr=${q}`;
    return `https://maps.apple.com/?daddr=${p.lat},${p.lng}${q ? `&q=${q}` : ""}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${
    hasPoint ? `${p.lat},${p.lng}` : q
  }`;
}
