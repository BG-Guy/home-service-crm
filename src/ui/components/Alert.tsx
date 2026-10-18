"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cx } from "../cx";
import { createConfirmStore } from "./confirm-store";
import { lockScroll } from "./dialog-utils";

export interface AlertAction {
  label: string;
  /** `cancel` runs on Esc too; `destructive` is red. */
  style?: "default" | "cancel" | "destructive";
  /** Bold (the preferred action). Defaults to the cancel action. */
  preferred?: boolean;
  disabled?: boolean;
  /** Runs after the alert starts closing (iOS semantics). */
  onPress?: () => void;
  /** Keep the alert open after pressing (e.g. async validation). */
  keepOpen?: boolean;
}

/**
 * Centered iOS alert on a native `<dialog>` (SPEC §12.6): 1–2 actions side by
 * side, 3+ stacked. Esc / the cancel action closes it. Enter and exit animate
 * with CSS (`@starting-style`), so there is no animation JS.
 *
 * ```tsx
 * <Alert open={open} onOpenChange={setOpen} title="Delete photo?" message="This can't be undone."
 *   actions={[{ label: "Cancel", style: "cancel" }, { label: "Delete", style: "destructive", onPress: del }]} />
 * ```
 */
export function Alert({
  open,
  onOpenChange,
  title,
  message,
  actions = [{ label: "OK", style: "cancel" }],
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  message?: ReactNode;
  actions?: AlertAction[];
  /** Extra content between the message and the buttons (e.g. a text field). */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const msgId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    if (!d.open) d.showModal();
    const unlock = lockScroll();
    return () => {
      unlock();
      if (d.open) d.close();
    };
  }, [open]);

  const cancel = actions.find((a) => a.style === "cancel");
  const hasPreferred = actions.some((a) => a.preferred);
  const press = (a: AlertAction) => {
    if (!a.keepOpen) onOpenChange(false);
    a.onPress?.();
  };
  // iOS lays two short actions side by side and stacks them when a label wouldn't fit.
  const sideBySide =
    actions.length === 2 && actions.every((a) => a.label.length <= 13);

  return (
    <dialog
      ref={ref}
      className="alert"
      // An interrupting alert, not a plain dialog (QA2 NEW-11).
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={message ? msgId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (cancel) press(cancel);
        else onOpenChange(false);
      }}
    >
      <div className="px-4 pb-4 pt-5 text-center">
        <h2 id={titleId} className="text-headline">
          {title}
        </h2>
        {message && (
          <div id={msgId} className="mt-0.5 text-footnote">
            {message}
          </div>
        )}
        {children && <div className="mt-3 text-left">{children}</div>}
      </div>
      <div
        className={cx(
          "hairline-t grid",
          sideBySide ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            disabled={a.disabled}
            onClick={() => press(a)}
            className={cx(
              "min-h-11 px-2 text-body outline-offset-[-2px] active:bg-fill-2 disabled:opacity-40",
              a.style === "destructive" ? "text-danger" : "text-accent-text",
              (a.preferred || (!hasPreferred && a.style === "cancel")) &&
                "font-semibold",
              i > 0 &&
                (sideBySide
                  ? "shadow-[inset_0.5px_0_0_var(--sep)]"
                  : "hairline-t"),
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Promise-based confirm. Render the returned element once; call `confirm()`.
 * Safe to await inside `startTransition(async () => …)`: the alert lives in an
 * external store, so it opens synchronously instead of waiting for the
 * transition (which would wait for the alert: a deadlock).
 *
 * ```tsx
 * const [confirm, confirmEl] = useConfirm();
 * if (await confirm({ title: "Archive job?", destructive: true })) archive();
 * return <>{confirmEl}…</>;
 * ```
 */
export function useConfirm(): [
  (o: ConfirmOptions) => Promise<boolean>,
  ReactNode,
] {
  const [store] = useState(createConfirmStore<ConfirmOptions>);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  // An unmount (navigation) settles a pending confirm as "cancel".
  useEffect(() => () => store.finish(false), [store]);
  const el = (
    <Alert
      open={state != null}
      // Every close path (buttons, Esc → cancel action) resolves via onPress.
      onOpenChange={() => {}}
      title={state?.title ?? ""}
      message={state?.message}
      actions={[
        {
          label: state?.cancelLabel ?? "Cancel",
          style: "cancel",
          onPress: () => store.finish(false),
        },
        {
          label: state?.confirmLabel ?? "OK",
          style: state?.destructive ? "destructive" : "default",
          preferred: !state?.destructive,
          onPress: () => store.finish(true),
        },
      ]}
    />
  );
  return [store.open, el];
}
