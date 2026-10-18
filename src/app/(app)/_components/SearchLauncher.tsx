"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { isSearchHotkey, OPEN_SEARCH_EVENT } from "./search-bus";

// The palette's code loads on first use (⌘K or the header button), not with the shell.
const SearchPalette = lazy(() =>
  import("./SearchPalette").then((m) => ({ default: m.SearchPalette })),
);

/** Mounted once by the (app) layout: listens for ⌘K / Ctrl+K and openSearch(). */
export function SearchLauncher() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const show = () => {
      setLoaded(true);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchHotkey(e)) return;
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
    };
  }, []);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <SearchPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}
