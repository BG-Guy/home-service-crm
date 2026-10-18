"use client";

import {
  createContext,
  type FormEvent,
  type FormHTMLAttributes,
  type ReactNode,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import type { ActionResult } from "@/lib/types";
import {
  Select,
  type SelectProps,
  TextArea,
  type TextAreaProps,
  TextField,
  type TextFieldProps,
} from "@/ui/components/Field";
import { MoneyField } from "@/ui/components/MoneyField";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";

// Small form kit for B8 screens (settings, team): a server action bound with
// useActionState, toast feedback, and field errors from action() fed to the UI-kit
// fields through context. Works inline (<ActionForm>) or with a Save button that lives
// outside the <form> (sheet header) via useActionForm() + `form={id}`.

// biome-ignore lint/suspicious/noExplicitAny: any action result payload
export type FormAction<T = any> = (
  prev: ActionResult<T> | null,
  input: FormData,
) => Promise<ActionResult<T>>;

const ErrorsContext = createContext<Record<string, string[]> | undefined>(
  undefined,
);

/** First error for a field name (`a.b` paths, as action() reports them). */
export function useFieldError(name: string | undefined): string | undefined {
  const errors = useContext(ErrorsContext);
  if (!name || !errors) return undefined;
  return errors[name]?.[0] ?? errors[name.replace(/\[\]$/, "")]?.[0];
}

export function FormErrors({
  errors,
  children,
}: {
  errors: Record<string, string[]> | undefined;
  children: ReactNode;
}) {
  return (
    <ErrorsContext.Provider value={errors}>{children}</ErrorsContext.Provider>
  );
}

export interface ActionFormOptions<T> {
  /** Success toast title (false = no toast). */
  success?: string | false | ((data: T | undefined) => string | false);
  onSuccess?: (data: T | undefined) => void;
  onError?: (error: string) => void;
}

/**
 * Bind a server action for a form. Returns props for the `<form>`, the pending flag,
 * the latest result and its field errors. Toasts on success and failure.
 */
export function useActionForm<T>(
  action: FormAction<T>,
  opts: ActionFormOptions<T> = {},
) {
  const id = useId();
  const [state, formAction, pending] = useActionState(action, null);
  const seen = useRef<ActionResult<T> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    const o = optsRef.current;
    if (state.ok) {
      const title =
        typeof o.success === "function"
          ? o.success(state.data)
          : (o.success ?? "Saved");
      if (title) toast.success(title);
      o.onSuccess?.(state.data);
    } else {
      toast.error(state.error);
      o.onError?.(state.error);
    }
  }, [state]);
  // Submitted through onSubmit, not the `action` prop: React resets a form's
  // uncontrolled fields once a form action settles, even when it returned an
  // error, so a failed save used to wipe what was typed (QA2 re-check,
  // Compliance quiet hours). Same approach as the auth forms (useAuthForm).
  // useFormStatus still reports pending: React marks the form pending when a
  // prevented submit starts a transition.
  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const submitter = (e.nativeEvent as SubmitEvent).submitter;
      let fd: FormData;
      try {
        fd = new FormData(form, submitter);
      } catch {
        fd = new FormData(form);
      }
      startTransition(() => formAction(fd));
    },
    [formAction],
  );
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return {
    id,
    pending,
    state,
    errors,
    formProps: { id, onSubmit, noValidate: false },
  };
}

/** Inline form bound to a server action (toast + field errors). */
export function ActionForm<T>({
  action,
  children,
  className,
  success,
  onSuccess,
  ...rest
}: {
  action: FormAction<T>;
  children: ReactNode | ((s: { pending: boolean }) => ReactNode);
  className?: string;
} & ActionFormOptions<T> &
  Omit<FormHTMLAttributes<HTMLFormElement>, "action" | "children">) {
  const f = useActionForm(action, { success, onSuccess });
  return (
    <FormErrors errors={f.errors}>
      <form {...f.formProps} {...rest} className={className}>
        {typeof children === "function"
          ? children({ pending: f.pending })
          : children}
      </form>
    </FormErrors>
  );
}

/* ---------------------------------------------------------------- fields */

export function FText(props: TextFieldProps & { name: string }) {
  const err = useFieldError(props.name);
  return <TextField {...props} error={props.error ?? err} />;
}

export function FArea(props: TextAreaProps & { name: string }) {
  const err = useFieldError(props.name);
  return <TextArea {...props} error={props.error ?? err} />;
}

export function FSelect(props: SelectProps & { name: string }) {
  const err = useFieldError(props.name);
  return <Select {...props} error={props.error ?? err} />;
}

export function FMoney(
  props: Parameters<typeof MoneyField>[0] & { name: string },
) {
  const err = useFieldError(props.name);
  return <MoneyField {...props} error={props.error ?? err} />;
}

/** A padded card for stacked form fields (inside a ListGroup or a sheet). */
export function FieldCard({
  header,
  footer,
  children,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {header && (
        <h2 className="px-4 pb-1.5 text-footnote uppercase text-label-2">
          {header}
        </h2>
      )}
      <div className="flex flex-col gap-4 rounded-card bg-card p-4">
        {children}
      </div>
      {footer && (
        <div className="px-4 pt-1.5 text-footnote text-label-2">{footer}</div>
      )}
    </section>
  );
}

/** Error line for a whole-form or array field (renders nothing without an error). */
export function FieldErrorText({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const err = useFieldError(name);
  if (!err) return null;
  return (
    <p role="alert" className={cx("text-footnote text-danger", className)}>
      {err}
    </p>
  );
}

/**
 * Floating Save bar for long settings forms: stays above the tab bar on phones and
 * at the bottom of the content on desktop. Render it inside the `<form>`.
 */
export function StickySave({
  pending,
  label = "Save",
  disabled,
}: {
  pending: boolean;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="pointer-events-none sticky bottom-[calc(var(--tabbar-space)+4px)] z-10 mt-6 flex justify-center lg:bottom-6">
      <button
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        className="pressable pointer-events-auto flex min-h-[50px] w-full max-w-md items-center justify-center gap-2 rounded-full bg-accent px-6 text-body font-semibold text-on-accent shadow-float disabled:opacity-60"
      >
        {pending && (
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
