import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../cx";

export type IconButtonVariant = "plain" | "gray" | "filled" | "material";

interface Own {
  /** Accessible name (required: icon-only controls need one). Also the tooltip. */
  label: string;
  /** The icon (lucide at 20–22 px). */
  children: ReactNode;
  /** `plain` (accent glyph), `gray` (fill circle), `filled` (accent circle), `material` (glass circle). */
  variant?: IconButtonVariant;
  /** Visual circle diameter: 30, 36 or 44 px. The hit target is always ≥ 44 px. */
  size?: 30 | 36 | 44;
  /** Small count/dot badge on the top-right corner. */
  badge?: ReactNode;
  className?: string;
}

const variantCls: Record<IconButtonVariant, string> = {
  plain: "text-accent-text hover:bg-fill-2",
  gray: "bg-fill-2 text-label-2 hover:bg-fill",
  filled: "bg-accent text-on-accent",
  material: "material text-label shadow-[0_0_0_0.5px_var(--sep)]",
};

function cls(variant: IconButtonVariant, size: number, className?: string) {
  return cx(
    "pressable relative inline-flex shrink-0 items-center justify-center rounded-full outline-offset-2 disabled:pointer-events-none disabled:opacity-40",
    // Grow the hit target to 44 px when the circle is smaller.
    size < 44 &&
      "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
    variantCls[variant],
    className,
  );
}

/**
 * Icon-only button with a 44 px hit target and an aria-label (SPEC §12.6).
 * Renders a `<Link>` when `href` is given (`transition: 'push' | 'back'`).
 */
export function IconButton(
  props: Own &
    (
      | (Omit<
          ButtonHTMLAttributes<HTMLButtonElement>,
          "children" | "className"
        > & { href?: undefined; ref?: Ref<HTMLButtonElement> })
      | {
          href: string;
          transition?: "push" | "back" | "none";
          ref?: Ref<HTMLAnchorElement>;
        }
    ),
) {
  const {
    label,
    children,
    variant = "plain",
    size = 44,
    badge,
    className,
  } = props;
  const style = { width: size, height: size };
  const content = (
    <>
      {children}
      {badge != null && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5">
          {badge}
        </span>
      )}
    </>
  );
  if (props.href != null) {
    const t = props.transition;
    return (
      <Link
        href={props.href}
        ref={props.ref}
        aria-label={label}
        title={label}
        transitionTypes={
          t === "push"
            ? ["nav-forward"]
            : t === "back"
              ? ["nav-back"]
              : undefined
        }
        className={cls(variant, size, className)}
        style={style}
      >
        {content}
      </Link>
    );
  }
  const {
    label: _l,
    children: _c,
    variant: _v,
    size: _s,
    badge: _b,
    className: _cn,
    href: _h,
    type = "button",
    ...rest
  } = props;
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cls(variant, size, className)}
      style={style}
      {...rest}
    >
      {content}
    </button>
  );
}
