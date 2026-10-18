// ⌘K search palette wiring (QA T2-11): any client component can open it.
export const OPEN_SEARCH_EVENT = "crm:open-search";

export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

/** ⌘K / Ctrl+K. */
export function isSearchHotkey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === "k"
  );
}
