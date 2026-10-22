// For components that open a `trigger="none"` FullscreenHub from a tap and
// mount it lazily (PhotoGrid → PhotoViewer, SignatureField → SignatureCapture).

/**
 * Drops a `?fs=<key>` left in the URL by a reload while that hub was open.
 * Otherwise the hub, opened later, finds its key already there, pushes no
 * history entry, and its close pops the page's own entry (leaving the page).
 * Call it right before opening from a user's tap, never for a restore.
 */
export function dropStaleFullscreenParam(key: string): void {
  if (typeof location === "undefined") return;
  const u = new URL(location.href);
  if (u.searchParams.get("fs") !== key) return;
  u.searchParams.delete("fs");
  history.replaceState(history.state, "", u.pathname + u.search + u.hash);
}
