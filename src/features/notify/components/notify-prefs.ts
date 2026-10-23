// Notification center preferences (isomorphic, no imports): the layout lives in a
// plain cookie, like the other list layouts, so the server renders it with no flash.

export const NOTIFY_LAYOUT_COOKIE = "notifications-layout";
export type NotifyLayout = "list" | "cards";
export type NotifySort = "newest" | "oldest" | "unread" | "urgent";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The list stays the default; cards are the option. */
export function parseNotifyLayout(v: string | null | undefined): NotifyLayout {
  return v === "cards" ? "cards" : "list";
}

/** Client only: remember the choice on this device. */
export function writeNotifyLayout(v: NotifyLayout): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a tiny UI preference, like the Appearance cookie
  document.cookie = `${NOTIFY_LAYOUT_COOKIE}=${v}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
