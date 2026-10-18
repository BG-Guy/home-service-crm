import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cx } from "../cx";

export type ToggleProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "role" | "size"
> & {
  /** Accessible name when the toggle has no visible `<label>` (e.g. inside a ListRow). */
  label?: string;
  /**
   * Render Safari's native `<input switch>` (system look + iOS haptic). Gate it on
   * `settings.ui.haptics_hack`; other browsers fall back to the CSS switch.
   */
  nativeSwitch?: boolean;
  ref?: Ref<HTMLInputElement>;
};

/**
 * iOS switch, 51×31, green when on (SPEC §12.6). A styled
 * `<input type="checkbox" role="switch">`: works in forms, is keyboard-operable
 * (Space), needs no JS, and is server-renderable. Use `checked`/`onChange`
 * (client) or `defaultChecked` + `name` (plain forms).
 */
export function Toggle({
  label,
  nativeSwitch,
  className,
  ...rest
}: ToggleProps) {
  const extra = nativeSwitch ? { switch: "" } : null;
  return (
    <input
      type="checkbox"
      // biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox exposes its checked state to the switch role
      role="switch"
      aria-label={label}
      className={cx("ios-switch", className)}
      {...extra}
      {...rest}
    />
  );
}

/**
 * A full list row that is a `<label>`: tapping anywhere flips the switch.
 * Use inside `<ListSection>`.
 */
export function ToggleRow({
  title,
  subtitle,
  icon,
  className,
  ...toggle
}: Omit<ToggleProps, "title"> & {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional leading icon tile (pre-styled node). */
  icon?: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the Toggle input is a descendant
    <label
      className={cx(
        "list-row flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5",
        className,
      )}
      data-icon={icon ? "" : undefined}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="text-body">{title}</span>
        {subtitle && (
          <span className="text-subhead text-label-2">{subtitle}</span>
        )}
      </span>
      <Toggle {...toggle} />
    </label>
  );
}
