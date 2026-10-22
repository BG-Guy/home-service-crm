"use client";

import type { ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import { openFullscreen } from "./FullscreenHub";
import { IconButton, type IconButtonVariant } from "./IconButton";

/**
 * Opens a FullscreenHub from outside its region, by the hub's `historyKey`: a
 * header button (the live map's "Wall mode", the schedule board on phones).
 * Server pages render it directly. With `children` it is a Button; without, an
 * IconButton named by `label`. The hub's own corner Expand keeps working.
 *
 * ```tsx
 * <FullscreenButton hub="wall" icon={<Tv size={18} aria-hidden />}>Wall mode</FullscreenButton>
 * <FullscreenButton hub="board" label="Full screen board" icon={<Maximize2 size={18} aria-hidden />} />
 * ```
 */
export function FullscreenButton({
  hub,
  label,
  icon,
  children,
  variant,
  size,
  iconVariant = "secondary",
  iconSize = 44,
  className,
}: {
  /** The hub's `historyKey`. */
  hub: string;
  /** Accessible name (required without `children`). */
  label?: string;
  icon?: ReactNode;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconVariant?: IconButtonVariant;
  iconSize?: 30 | 36 | 40 | 44 | 48 | 56;
  className?: string;
}) {
  const open = () => openFullscreen(hub);
  return children != null ? (
    <Button
      variant={variant ?? "secondary"}
      size={size ?? "sm"}
      icon={icon}
      aria-label={label}
      className={className}
      onClick={open}
    >
      {children}
    </Button>
  ) : (
    <IconButton
      label={label ?? "Full screen"}
      variant={iconVariant}
      size={iconSize}
      className={className}
      onClick={open}
    >
      {icon}
    </IconButton>
  );
}
