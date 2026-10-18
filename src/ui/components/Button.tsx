import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "filled"
  | "tinted"
  | "gray"
  | "plain"
  | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonOwnProps {
  /** Visual style (SPEC §12.6). Default `filled`. */
  variant?: ButtonVariant;
  /** `sm` 34 px (hit area still 44), `md` 44 px, `lg` 50 px. Default `md`. */
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy` and disables the button. */
  loading?: boolean;
  /** Leading icon (e.g. a lucide icon at 18–20 px). */
  icon?: ReactNode;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

export type ButtonLinkProps = ButtonOwnProps &
  Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "className" | "children" | "href"
  > & {
    /** Renders a Next `<Link>` instead of a `<button>`. */
    href: string;
    /** View transition for the navigation: `push` (drill down), `back`, or none. */
    transition?: "push" | "back" | "none";
    prefetch?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

const base =
  "pressable relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold outline-offset-2 disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const sizes: Record<ButtonSize, string> = {
  // 34 px visual; the ::before extends the hit target to 44 px.
  sm: "h-[34px] px-3.5 text-subhead before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']",
  md: "min-h-11 px-5 text-body",
  lg: "min-h-[50px] px-6 text-body",
};

const variants: Record<ButtonVariant, string> = {
  filled: "bg-accent text-on-accent hover:brightness-110",
  tinted: "bg-accent/15 text-accent-text hover:bg-accent/20",
  gray: "bg-fill-2 text-accent-text hover:bg-fill",
  plain: "bg-transparent text-accent-text hover:bg-fill-2",
  destructive: "bg-danger text-white hover:brightness-110",
};

/** Class string for elements that should look like a Button (e.g. a `<label>`). */
export function buttonClass({
  variant = "filled",
  size = "md",
  fullWidth,
  className,
}: Pick<ButtonOwnProps, "variant" | "size" | "fullWidth" | "className"> = {}) {
  return cx(
    base,
    sizes[size],
    variants[variant],
    fullWidth && "w-full",
    className,
  );
}

function Inner({
  loading,
  icon,
  children,
  size,
}: Pick<ButtonOwnProps, "loading" | "icon" | "children" | "size">) {
  const spin = <Spinner size={size === "sm" ? 16 : 18} />;
  return (
    <>
      {loading ? (
        spin
      ) : icon ? (
        <span className="-ml-0.5 flex">{icon}</span>
      ) : null}
      {children != null && <span className="truncate">{children}</span>}
    </>
  );
}

/**
 * iOS button. Server-renderable; renders a Next `<Link>` when `href` is set.
 *
 * ```tsx
 * <Button variant="filled" size="lg" fullWidth loading={pending}>Save</Button>
 * <Button href="/jobs/new" variant="tinted" icon={<Plus size={18} />}>New job</Button>
 * ```
 */
export function Button(props: ButtonProps | ButtonLinkProps) {
  if (props.href != null) {
    const {
      variant,
      size,
      loading,
      icon,
      fullWidth,
      className,
      children,
      href,
      transition = "none",
      ...rest
    } = props;
    return (
      <Link
        href={href}
        transitionTypes={
          transition === "push"
            ? ["nav-forward"]
            : transition === "back"
              ? ["nav-back"]
              : undefined
        }
        aria-disabled={loading || undefined}
        aria-busy={loading || undefined}
        className={buttonClass({ variant, size, fullWidth, className })}
        {...rest}
      >
        <Inner loading={loading} icon={icon} size={size}>
          {children}
        </Inner>
      </Link>
    );
  }
  const {
    variant,
    size,
    loading,
    icon,
    fullWidth,
    className,
    children,
    type = "button",
    disabled,
    ...rest
  } = props;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, fullWidth, className })}
      {...rest}
    >
      <Inner loading={loading} icon={icon} size={size}>
        {children}
      </Inner>
    </button>
  );
}
