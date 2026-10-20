"use client";

import { Ellipsis } from "lucide-react";
import dynamic from "next/dynamic";
import { type ComponentProps, useEffect, useState } from "react";
import { IconButton } from "@/ui/components/IconButton";
import type { JobOfficeMenu } from "./JobOfficeMenu";

// The nav-bar "…" for office users. Only the button ships with the page; the
// menu, its action sheet and every office sheet load on first tap (warmed on
// hover, touch or after 2.5 s idle). A deep link (`?action=assign`) mounts it at once.

const load = () => import("./JobOfficeMenu");
const Menu = dynamic(load, { ssr: false });

export function JobOfficeMenuButton(
  props: Omit<ComponentProps<typeof JobOfficeMenu>, "openSignal">,
) {
  const [signal, setSignal] = useState(0);
  // Warm the menu chunk once the page is idle (not part of the first load).
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const mounted = signal > 0 || props.initial != null;
  return (
    <>
      <IconButton
        label="Job actions"
        variant="plain"
        aria-haspopup="menu"
        onPointerEnter={() => void load()}
        onTouchStart={() => void load()}
        onClick={() => setSignal((n) => n + 1)}
      >
        <Ellipsis size={22} />
      </IconButton>
      {mounted && <Menu {...props} openSignal={signal} />}
    </>
  );
}
