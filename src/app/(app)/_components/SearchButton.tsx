"use client";

import { Search } from "lucide-react";
import { IconButton } from "@/ui/components/IconButton";
import { openSearch } from "./search-bus";

/** Header entry to the ⌘K search palette. */
export function SearchButton() {
  return (
    <IconButton label="Search (⌘K)" onClick={openSearch}>
      <Search aria-hidden size={22} strokeWidth={2} />
    </IconButton>
  );
}
