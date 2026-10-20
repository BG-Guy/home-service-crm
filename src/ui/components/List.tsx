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
/* SectionHeader                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Bold sentence-case section title for content pages (DESIGN.md §5): 20/700 with
 * an optional subtitle and a trailing action ("See all"). Usable without a list;
 * `ListSection variant="title"` renders the same header.
 *
 * ```tsx
 * <SectionHeader title="Today's route" actionHref="/schedule" />
 * <SectionHeader title="Needs attention" subtitle="3 items" action={<Button size="sm" variant="tinted">Review</Button>} />
 * ```
 */
export function SectionHeader({
  title,
  subtitle,
  action,
  actionHref,
  actionLabel = "See all",
  as: Tag = "h2",
  id,
  className,
}: {
  title: ReactNode;
  /** One quiet line under the title (counts, dates). */
  subtitle?: ReactNode;
  /** Trailing node (link, small button). Wins over `actionHref`. */
  action?: ReactNode;
  /** Renders a "See all" style link (push transition). */
  actionHref?: string;
  /** Label for `actionHref` (default "See all"). */
  actionLabel?: ReactNode;
  /** Heading level (default `h2`). */
  as?: "h2" | "h3" | "h4";
  /** Id of the heading (for `aria-labelledby`). */
  id?: string;
  className?: string;
}) {
  const trailing =
    action ??
    (actionHref != null ? (
      <Link
        href={actionHref}
        transitionTypes={["nav-forward"]}
        className="hit-44 shrink-0 rounded-pill text-subhead font-semibold text-accent-text"
      >
        {actionLabel}
      </Link>
    ) : null);
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 px-1 pb-3",
        className,
      )}
    >
      <div className="min-w-0">
        <Tag id={id} className="text-title3 text-label">
          {title}
        </Tag>
        {subtitle != null && (
          <p className="mt-0.5 text-subhead text-label-2">{subtitle}</p>
        )}
      </div>
      {trailing}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ListGroup / ListSection                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Vertical stack of `ListSection`s with the section gap (28 px).
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
 * Inset grouped list section (DESIGN.md §5): a header, a radius-20 card with
 * hairline separators inset to the text, and footer text. Each child becomes a
 * list item. Header `variant`:
 *  - `caption` (default): 15/600 secondary, sentence case — settings and forms.
 *  - `title`: 20/700 bold section title with an optional `action` — content pages.
 */
export function ListSection({
  header,
  footer,
  trailing,
  action,
  variant = "caption",
  subtitle,
  children,
  className,
  id,
}: {
  /** Section title (rendered as an `<h2>`). Sentence case, never uppercase. */
  header?: ReactNode;
  /** Explanatory footnote under the card. */
  footer?: ReactNode;
  /** Small action on the header line (e.g. a "See all" link). */
  trailing?: ReactNode;
  /** Same as `trailing`. */
  action?: ReactNode;
  /** Header style: `caption` (default) or `title`. */
  variant?: "caption" | "title";
  /** Quiet line under a `title` header. */
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const items = Children.toArray(children);
  const headerId = id ? `${id}-h` : undefined;
  const act = action ?? trailing;
  return (
    <section
      id={id}
      aria-labelledby={header ? headerId : undefined}
      className={className}
    >
      {variant === "title" && (header || act) ? (
        <SectionHeader
          id={headerId}
          title={header}
          subtitle={subtitle}
          action={act}
        />
      ) : (
        (header || act) && (
          <div className="flex items-end justify-between gap-3 px-4 pb-2">
            {header ? (
              <h2
                id={headerId}
                className="text-subhead font-semibold text-label-2"
              >
                {header}
              </h2>
            ) : (
              <span />
            )}
            {act && (
              <div className="hit-44-kids text-subhead font-medium">{act}</div>
            )}
          </div>
        )
      )}
      <ul className="list-card">
        {items.map((child, i) => (
          <li key={isValidElement(child) && child.key != null ? child.key : i}>
            {child}
          </li>
        ))}
      </ul>
      {footer && (
        <div className="px-4 pt-2 text-footnote text-label-2">{footer}</div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ListRow                                                                    */
/* -------------------------------------------------------------------------- */

export type ListAccessory = "chevron" | "check" | "badge" | "external" | "none";

export interface ListRowProps {
  /** Glyph in a 32 px rounded-square tile (soft tint of `iconTone` by default). */
  icon?: ReactNode;
  /** Tile color for `icon` (default accent). */
  iconTone?: Tone;
  /** `tinted` (default) = soft tint; `filled` = white glyph on the color. */
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
  /** Center the title (action rows like "Sign out"). */
  centered?: boolean;
  disabled?: boolean;
  /** Allow multi-line title/subtitle (default truncates to one line). */
  multiline?: boolean;
  /** Semibold title (rich rows in content lists: jobs, leads, customers). */
  bold?: boolean;
  /** 44 px minimum height instead of 52 (dense settings rows). */
  dense?: boolean;
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
          strokeWidth={2.25}
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
 * List row (DESIGN.md §5): ≥ 52 px, tinted icon tile or avatar, title/subtitle,
 * right detail, accessory. Renders a push `<Link>` with `href`, a `<button>` with
 * `onClick`, otherwise a static row. Server-renderable.
 *
 * ```tsx
 * <ListRow icon={<Briefcase size={18} />} iconTone="orange" title="Jobs" detail="12" href="/jobs" />
 * ```
 */
export function ListRow({
  icon,
  iconTone = "accent",
  iconStyle = "tinted",
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
  bold,
  dense,
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
            "icon-tile",
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
          "flex min-w-0 flex-1 flex-col py-2.5",
          centered && "items-center text-center",
        )}
      >
        <span
          className={cx(
            "text-body",
            bold && "font-semibold",
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
    "list-row flex w-full items-center gap-3 pl-4 pr-4 text-left outline-offset-[-2px]",
    dense ? "min-h-[var(--row-min-dense)]" : "min-h-[var(--row-min)]",
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
