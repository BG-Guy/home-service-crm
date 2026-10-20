import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../cx";

/**
 * `plain` accent glyph, no fill · `secondary` (= legacy `gray`) neutral `--fill`
 * circle with a `--label` glyph (hero-card call / text / navigate) · `tinted`
 * accent wash · `primary` (= legacy `filled`) accent circle · `material` glass.
 */
export type IconButtonVariant =
  | "plain"
  | "secondary"
  | "tinted"
  | "primary"
  | "material"
  | "gray"
  | "filled";

interface Own {
  /** Accessible name (required: icon-only controls need one). Also the tooltip. */
  label: string;
  /** The icon (lucide at 18–22 px). */
  children: ReactNode;
  variant?: IconButtonVariant;
  /** Visual circle diameter in px. The hit target is always ≥ 44 px. */
  size?: 30 | 36 | 40 | 44 | 48 | 56;
  /** Red glyph / wash (delete, stop). */
  destructive?: boolean;
  /** Small count/dot badge on the top-right corner. */
  badge?: ReactNode;
  className?: string;
}

const variantCls: Record<IconButtonVariant, string> = {
  plain: "btn-plain",
  secondary: "btn-secondary",
  gray: "btn-secondary",
  tinted: "btn-tinted",
  primary: "btn-primary",
  filled: "btn-primary",
  material: "material text-label shadow-[0_0_0_0.5px_var(--sep)]",
};

function cls(
  variant: IconButtonVariant,
  size: number,
  destructive?: boolean,
  className?: string,
) {
  return cx(
    "btn pressable shrink-0",
    // Grow the hit target to 44 px when the circle is smaller.
    size < 44 &&
      "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
    variantCls[variant],
    destructive && "btn-destructive",
    className,
  );
}

/**
 * Icon-only round button with a 44 px hit target and an aria-label (DESIGN.md §5).
 * Renders a `<Link>` when `href` is given (`transition: 'push' | 'back'`).
 *
 * ```tsx
 * <IconButton label="Call" variant="secondary" size={44} href="tel:+15551234567"><Phone size={20} /></IconButton>
 * ```
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
          /** Open in a new tab (maps, external links). */
          external?: boolean;
          ref?: Ref<HTMLAnchorElement>;
        }
    ),
) {
  const {
    label,
    children,
    variant = "plain",
    size = 44,
    destructive,
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
        target={props.external ? "_blank" : undefined}
        rel={props.external ? "noopener noreferrer" : undefined}
        transitionTypes={
          t === "push"
            ? ["nav-forward"]
            : t === "back"
              ? ["nav-back"]
              : undefined
        }
        className={cls(variant, size, destructive, className)}
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
    destructive: _d,
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
      className={cls(variant, size, destructive, className)}
      style={style}
      {...rest}
    >
      {content}
    </button>
  );
}
