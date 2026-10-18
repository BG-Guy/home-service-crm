import { Check, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  Children,
  type CSSProperties,
  isValidElement,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";
import { Badge } from "./Badge";

/* -------------------------------------------------------------------------- */
/* ListGroup / ListSection                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Vertical stack of `ListSection`s with the iOS grouped spacing (35 px).
 * Put it inside a page container (it doesn't add side gutters).
 */
export function ListGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-[var(--section-gap)]", className)}>
      {children}
    </div>
  );
}

/**
 * Inset grouped list section (SPEC §12.4): 13 px uppercase header, a radius-12
 * card with hairline separators, and footer text. Each child becomes a list item.
 */
export function ListSection({
  header,
  footer,
  trailing,
  children,
  className,
  id,
}: {
  /** Section title (rendered as an `<h2>`). */
  header?: ReactNode;
  /** Explanatory footnote under the card. */
  footer?: ReactNode;
  /** Small action on the header line (e.g. a "See all" link). */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const items = Children.toArray(children);
  const headerId = id ? `${id}-h` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={header ? headerId : undefined}
      className={className}
    >
      {(header || trailing) && (
        <div className="flex items-end justify-between gap-3 px-4 pb-1.5">
          {header ? (
            <h2 id={headerId} className="text-footnote uppercase text-label-2">
              {header}
            </h2>
          ) : (
            <span />
          )}
          {trailing && (
            <div className="hit-44-kids text-footnote">{trailing}</div>
          )}
        </div>
      )}
      <ul className="list-card">
        {items.map((child, i) => (
          <li key={isValidElement(child) && child.key != null ? child.key : i}>
            {child}
          </li>
        ))}
      </ul>
      {footer && (
        <div className="px-4 pt-1.5 text-footnote text-label-2">{footer}</div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ListRow                                                                    */
/* -------------------------------------------------------------------------- */

export type ListAccessory = "chevron" | "check" | "badge" | "external" | "none";

export interface ListRowProps {
  /** Glyph shown in a 29 px rounded-square tile (white on `iconTone`). */
  icon?: ReactNode;
  /** Tile color for `icon` (default accent). */
  iconTone?: Tone;
  /** `filled` = iOS Settings style (white glyph on color); `tinted` = soft tint. */
  iconStyle?: "filled" | "tinted";
  /** Custom leading content instead of `icon` (e.g. an `<Avatar>`). */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned value in `--label-2`. */
  detail?: ReactNode;
  /** Trailing element: a preset or any node (e.g. `<Toggle/>`). Links default to `chevron`. */
  accessory?: ListAccessory | ReactNode;
  /** Count shown when `accessory="badge"`. */
  badge?: number;
  /** Red badge (critical counts only). */
  badgeCritical?: boolean;
  /** Makes the row a Next `<Link>` (push transition by default). */
  href?: string;
  /** `push` (default for links), `back`, or `none`. */
  transition?: "push" | "back" | "none";
  prefetch?: boolean;
  /** Opens in a new tab with the external accessory. */
  external?: boolean;
  /** Makes the row a `<button>` (client components only). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Red title text for destructive actions. */
  destructive?: boolean;
  /** Center the title (iOS action rows like "Sign out"). */
  centered?: boolean;
  disabled?: boolean;
  /** Allow multi-line title/subtitle (default truncates to one line). */
  multiline?: boolean;
  /** Separator inset override in px (default 16, or 60 with an icon). */
  sepInset?: number;
  /** `aria-current="page"` for nav rows. */
  current?: boolean;
  className?: string;
}

function AccessoryNode({
  accessory,
  badge,
  badgeCritical,
}: Pick<ListRowProps, "accessory" | "badge" | "badgeCritical">) {
  switch (accessory) {
    case undefined:
    case null:
    case "none":
      return null;
    case "chevron":
      return (
        <ChevronRight
          aria-hidden
          size={18}
          strokeWidth={2.5}
          className="-mr-1 shrink-0 text-label-3"
        />
      );
    case "check":
      return (
        <Check
          aria-hidden
          size={20}
          strokeWidth={2.75}
          className="shrink-0 text-accent-text"
        />
      );
    case "external":
      return (
        <ExternalLink aria-hidden size={16} className="shrink-0 text-label-3" />
      );
    case "badge":
      return badge ? (
        <Badge count={badge} tone={badgeCritical ? "red" : "gray"} />
      ) : null;
    default:
      return <>{accessory}</>;
  }
}

/**
 * iOS list row (SPEC §12.6): ≥ 44 px, icon tile, title/subtitle, right detail,
 * accessory. Renders a push `<Link>` with `href`, a `<button>` with `onClick`,
 * otherwise a static row. Server-renderable.
 *
 * ```tsx
 * <ListRow icon={<Briefcase size={17} />} iconTone="orange" title="Jobs" detail="12" href="/jobs" />
 * ```
 */
export function ListRow({
  icon,
  iconTone = "accent",
  iconStyle = "filled",
  leading,
  title,
  subtitle,
  detail,
  accessory,
  badge,
  badgeCritical,
  href,
  transition = "push",
  prefetch,
  external,
  onClick,
  destructive,
  centered,
  disabled,
  multiline,
  sepInset,
  current,
  className,
}: ListRowProps) {
  const interactive = (href != null || onClick != null) && !disabled;
  const acc =
    accessory ?? (external ? "external" : href != null ? "chevron" : undefined);
  const style: CSSProperties | undefined =
    sepInset != null
      ? ({ "--sep-inset": `${sepInset}px` } as CSSProperties)
      : undefined;

  const body = (
    <>
      {icon && (
        <span
          aria-hidden
          className={cx(
            "flex size-[29px] shrink-0 items-center justify-center rounded-[7px]",
            iconStyle === "filled" ? "tone-bg" : "tint-bg tint-fg",
          )}
          style={toneStyle(iconTone)}
        >
          {icon}
        </span>
      )}
      {!icon && leading}
      <span
        className={cx(
          "flex min-w-0 flex-1 flex-col py-[11px]",
          centered && "items-center text-center",
        )}
      >
        <span
          className={cx(
            "text-body",
            !multiline && "truncate",
            destructive
              ? "text-danger"
              : centered && interactive
                ? "text-accent-text"
                : "text-label",
          )}
        >
          {title}
        </span>
        {subtitle != null && (
          <span
            className={cx(
              "text-subhead text-label-2",
              !multiline && "truncate",
            )}
          >
            {subtitle}
          </span>
        )}
      </span>
      {detail != null && (
        <span className="num max-w-[50%] shrink-0 truncate text-right text-body text-label-2">
          {detail}
        </span>
      )}
      <AccessoryNode
        accessory={acc}
        badge={badge}
        badgeCritical={badgeCritical}
      />
    </>
  );

  const cls = cx(
    "list-row flex min-h-11 w-full items-center gap-3 pl-4 pr-4 text-left outline-offset-[-2px]",
    interactive && "row-press cursor-pointer",
    disabled && "opacity-40",
    className,
  );

  if (href != null && !disabled) {
    return (
      <Link
        href={href}
        prefetch={prefetch}
        className={cls}
        style={style}
        data-icon={icon ? "" : undefined}
        aria-current={current ? "page" : undefined}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        transitionTypes={
          external || transition === "none"
            ? undefined
            : transition === "back"
              ? ["nav-back"]
              : ["nav-forward"]
        }
      >
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cls}
        style={style}
        data-icon={icon ? "" : undefined}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={style} data-icon={icon ? "" : undefined}>
      {body}
    </div>
  );
}
