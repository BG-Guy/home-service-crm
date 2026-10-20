import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

/**
 * `primary` accent fill (the one next step per view) · `secondary` neutral fill ·
 * `tinted` accent wash · `plain` accent text · `destructive` red fill (confirm
 * step only). Legacy names: `filled` = primary, `gray` = secondary.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tinted"
  | "plain"
  | "destructive"
  | "filled"
  | "gray";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonOwnProps {
  /** Visual style (DESIGN.md §5). Default `primary`. */
  variant?: ButtonVariant;
  /** `sm` 34 px (hit area still 44), `md` 44 px, `lg` 52 px. Default `md`. */
  size?: ButtonSize;
  /**
   * Destructive role: recolors any variant red (`plain` → red text, `secondary` →
   * red text on the neutral fill, `tinted` → red wash). A red fill is
   * `variant="destructive"`, for the confirm step only.
   */
  destructive?: boolean;
  /** Shows a spinner (the label keeps its width), sets `aria-busy` and disables the button. */
  loading?: boolean;
  /** Text shown next to the spinner while `loading` (e.g. "Saving…"); the width may change. */
  loadingText?: ReactNode;
  /** Leading icon (e.g. a lucide icon at 18–20 px). */
  icon?: ReactNode;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Same as `fullWidth`. */
  block?: boolean;
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

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  filled: "btn-primary",
  secondary: "btn-secondary",
  gray: "btn-secondary",
  tinted: "btn-tinted",
  plain: "btn-plain",
  destructive: "btn-primary",
};

/** Class string for elements that should look like a Button (e.g. a `<label>`). */
export function buttonClass({
  variant = "primary",
  size = "md",
  destructive,
  fullWidth,
  block,
  className,
}: Pick<
  ButtonOwnProps,
  "variant" | "size" | "destructive" | "fullWidth" | "block" | "className"
> = {}) {
  return cx(
    "btn pressable select-none",
    `btn-${size}`,
    VARIANT_CLASS[variant],
    (variant === "destructive" || destructive) && "btn-destructive",
    (fullWidth || block) && "w-full",
    className,
  );
}

/** Overlay spinner (keeps the width) unless a loading text replaces the label. */
const busyClass = (loading?: boolean, loadingText?: ReactNode) =>
  loading && loadingText == null ? "btn-busy" : undefined;

function Inner({
  loading,
  loadingText,
  icon,
  children,
  size,
}: Pick<
  ButtonOwnProps,
  "loading" | "loadingText" | "icon" | "children" | "size"
>) {
  const spin = <Spinner size={size === "sm" ? 16 : 18} />;
  if (loading && loadingText != null) {
    return (
      <>
        <span className="-ml-0.5 flex shrink-0">{spin}</span>
        <span className="truncate">{loadingText}</span>
      </>
    );
  }
  return (
    <>
      {icon ? <span className="-ml-0.5 flex shrink-0">{icon}</span> : null}
      {children != null && <span className="truncate">{children}</span>}
      {loading && <span className="btn-spin">{spin}</span>}
    </>
  );
}

/**
 * Pill button (DESIGN.md §5). Server-renderable; renders a Next `<Link>` when
 * `href` is set. One `primary` per view; everything else secondary, tinted or plain.
 *
 * ```tsx
 * <Button size="lg" block loading={pending}>Save</Button>
 * <Button href="/jobs/new" variant="tinted" icon={<Plus size={18} />}>New job</Button>
 * <Button variant="plain" destructive>Delete</Button>
 * ```
 */
export function Button(props: ButtonProps | ButtonLinkProps) {
  if (props.href != null) {
    const {
      variant,
      size,
      destructive,
      loading,
      loadingText,
      icon,
      fullWidth,
      block,
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
        className={buttonClass({
          variant,
          size,
          destructive,
          fullWidth,
          block,
          className: cx(busyClass(loading, loadingText), className),
        })}
        {...rest}
      >
        <Inner
          loading={loading}
          loadingText={loadingText}
          icon={icon}
          size={size}
        >
          {children}
        </Inner>
      </Link>
    );
  }
  const {
    variant,
    size,
    destructive,
    loading,
    loadingText,
    icon,
    fullWidth,
    block,
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
      className={buttonClass({
        variant,
        size,
        destructive,
        fullWidth,
        block,
        className: cx(busyClass(loading, loadingText), className),
      })}
      {...rest}
    >
      <Inner
        loading={loading}
        loadingText={loadingText}
        icon={icon}
        size={size}
      >
        {children}
      </Inner>
    </button>
  );
}
