"use client";

import { MapPin } from "lucide-react";
import {
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  type AddressSuggestion,
  fetchAddressSuggestions,
  isAddressQuery,
} from "@/client/places";
import { cx } from "../cx";
import {
  type FieldChromeProps,
  FieldError,
  FieldShell,
  inputResetClass,
} from "./Field";
import { Spinner } from "./Spinner";

type FillKey = Exclude<keyof AddressSuggestion, "id">;

export type AddressAutocompleteProps = Omit<FieldChromeProps, "layout"> &
  Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "className" | "size" | "type" | "role" | "children" | "list"
  > & {
    /** What a pick writes into this input: the street line (default) or the whole one-line label. */
    pick?: "street" | "label";
    /**
     * Other fields of the same form, by `name`, filled on a pick, e.g.
     * `{ city: "address.city", state: "address.state", zip: "address.zip" }`.
     * Works for uncontrolled and React-controlled inputs and for `<select>`s.
     */
    fill?: Partial<Record<FillKey, string>>;
    /** `name` of the field to focus after a pick (e.g. the unit), so typing goes on. */
    focusAfter?: string;
    /** Called after a pick, once the fields are filled (controlled callers, coordinates). */
    onPick?: (s: AddressSuggestion) => void;
    /** Node before the input (icon). */
    leading?: ReactNode;
    /** Node after the input, inside the field (e.g. a small "Add" button). */
    trailing?: ReactNode;
    ref?: Ref<HTMLInputElement>;
  };

const DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 5;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function asControl(el: unknown): Control | null {
  return el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
    ? el
    : null;
}

/**
 * Write a form control's value the way typing (or browser autofill) would: the native
 * setter bypasses React's value tracker, so the bubbling input/change events reach
 * React onChange handlers of controlled inputs too. A `<select>` without that option
 * is left alone.
 */
function writeValue(el: Control, value: string): boolean {
  if (
    el instanceof HTMLSelectElement &&
    ![...el.options].some((o) => o.value === value)
  )
    return false;
  if (el.value === value) return true;
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Scroll a just-opened list above the on-screen keyboard, keeping the input in view. */
function reveal(list: HTMLElement, input: HTMLElement) {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const bottom = top + (vv?.height ?? window.innerHeight);
  const by = Math.min(
    list.getBoundingClientRect().bottom + 8 - bottom,
    input.getBoundingClientRect().top - top - 8,
  );
  if (by <= 0) return;
  let box = list.parentElement;
  while (
    box &&
    !(
      box.scrollHeight > box.clientHeight &&
      /auto|scroll/.test(getComputedStyle(box).overflowY)
    )
  )
    box = box.parentElement;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  (box ?? document.scrollingElement)?.scrollBy({
    top: by,
    behavior: still ? "auto" : "smooth",
  });
}

/**
 * Street input with address suggestions while typing (WAI-ARIA 1.2 combobox with a
 * listbox), styled like the kit's TextField (stacked layout). Suggestions come from
 * /api/places/autocomplete (signed-in staff only, so never on public pages) and
 * render in flow under the input, so sheets and scrolling bodies never clip them.
 * Picking fills this input and the sibling fields named in `fill`; ignoring the list
 * leaves a plain text input.
 *
 * ```tsx
 * <AddressAutocomplete label="Street" name="address.street"
 *   fill={{ city: "address.city", state: "address.state", zip: "address.zip" }}
 *   focusAfter="address.unit" />
 * ```
 */
export function AddressAutocomplete({
  label,
  hideLabel,
  hint,
  error,
  className,
  leading,
  trailing,
  pick = "street",
  fill,
  focusAfter,
  onPick,
  id,
  ref,
  onChange,
  onKeyDown,
  onBlur,
  autoComplete = "crm-street",
  ...input
}: AddressAutocompleteProps) {
  const auto = useId();
  const fid = id ?? auto;
  const listId = `${fid}-list`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const request = useRef<AbortController | null>(null);
  // Query whose suggestions are in `items`.
  const shownFor = useRef("");
  // True while a pick writes values (those input events are not typing).
  const writing = useRef(false);
  // Values the last pick wrote into sibling fields, by name.
  const wrote = useRef(new Map<string, string>());
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [credit, setCredit] = useState<string | null>(null);

  const message = Array.isArray(error)
    ? error.filter(Boolean).join(" ") || null
    : error || null;
  const descId = message || hint ? `${fid}-desc` : undefined;

  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      request.current?.abort();
    },
    [],
  );

  // When the list opens, bring it into view (phones: it may start under the keyboard).
  useEffect(() => {
    if (open && listRef.current && inputRef.current)
      reveal(listRef.current, inputRef.current);
  }, [open]);

  const stop = () => {
    clearTimeout(timer.current);
    request.current?.abort();
    request.current = null;
    setLoading(false);
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const search = (q: string) => {
    request.current?.abort();
    const ctrl = new AbortController();
    request.current = ctrl;
    setLoading(true);
    fetchAddressSuggestions(q, ctrl.signal).then(
      (r) => {
        if (ctrl.signal.aborted) return;
        request.current = null;
        const list = r.suggestions.slice(0, MAX_SUGGESTIONS);
        shownFor.current = q;
        setLoading(false);
        setItems(list);
        setCredit(r.attribution);
        setActive(-1);
        setOpen(list.length > 0 && document.activeElement === inputRef.current);
      },
      () => {
        if (ctrl.signal.aborted) return;
        request.current = null;
        setLoading(false);
      },
    );
  };

  const schedule = (value: string) => {
    clearTimeout(timer.current);
    const q = value.trim();
    if (!isAddressQuery(q)) {
      stop();
      close();
      setItems([]);
      shownFor.current = "";
    } else if (q === shownFor.current) {
      // Same query as the list (or the address just picked): no new request.
      if (items.length > 0) setOpen(true);
    } else {
      timer.current = setTimeout(() => search(q), DEBOUNCE_MS);
    }
  };

  const choose = (s: AddressSuggestion, moveFocus = true) => {
    const el = inputRef.current;
    if (!el) return;
    stop();
    writing.current = true;
    try {
      writeValue(el, pick === "label" ? s.label : s.street);
      for (const [key, name] of Object.entries(fill ?? {}) as [
        FillKey,
        string,
      ][]) {
        const field = asControl(el.form?.elements.namedItem(name));
        if (!field) continue;
        const value = String(s[key] ?? "");
        if (value) {
          if (writeValue(field, value)) wrote.current.set(name, value);
        } else if (wrote.current.get(name) === field.value) {
          // This suggestion has no value here: clear what an earlier pick wrote,
          // keep what the user typed.
          writeValue(field, "");
          wrote.current.delete(name);
        }
      }
    } finally {
      writing.current = false;
    }
    shownFor.current = el.value.trim();
    setItems([]);
    close();
    onPick?.(s);
    const next = focusAfter ? el.form?.elements.namedItem(focusAfter) : null;
    if (moveFocus && next instanceof HTMLElement) next.focus();
    else el.setSelectionRange(el.value.length, el.value.length);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange?.(e);
    if (!writing.current) schedule(e.currentTarget.value);
  };

  // Arrow keys: highlight an option and keep it on screen (hover only highlights).
  const highlight = (i: number) => {
    setOpen(true);
    setActive(i);
    requestAnimationFrame(() =>
      document
        .getElementById(`${listId}-${i}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    const current = open && active >= 0 ? items[active] : undefined;
    if (!e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown" && n > 0) {
        e.preventDefault();
        highlight(open ? (active + 1) % n : 0);
        return;
      }
      if (e.key === "ArrowUp" && n > 0 && open) {
        e.preventDefault();
        highlight(active <= 0 ? n - 1 : active - 1);
        return;
      }
      if (e.key === "Enter" && open) {
        // Picks the highlighted address; with none highlighted it only closes the
        // list, so a half-typed street isn't submitted by accident.
        e.preventDefault();
        if (current) choose(current);
        else {
          stop();
          close();
        }
        return;
      }
      if (e.key === "Escape" && open) {
        // Closes the list only (not the sheet around it).
        e.preventDefault();
        e.stopPropagation();
        stop();
        close();
        return;
      }
      if (e.key === "Tab" && current) choose(current, false);
      else if (e.key === "Tab") close();
    }
    onKeyDown?.(e);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    stop();
    close();
    onBlur?.(e);
  };

  const count = items.length;

  return (
    <div className={cx("flex flex-col", className)}>
      <FieldShell
        id={fid}
        label={label}
        hideLabel={hideLabel}
        leading={leading}
        trailing={
          loading || trailing ? (
            <>
              {loading && (
                <Spinner size={16} className="shrink-0 text-label-2" />
              )}
              {trailing}
            </>
          ) : undefined
        }
      >
        {() => (
          <input
            type="text"
            autoCorrect="off"
            spellCheck={false}
            className={inputResetClass}
            {...input}
            ref={setRef}
            id={fid}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={
              open && active >= 0 ? `${listId}-${active}` : undefined
            }
            aria-invalid={message ? true : undefined}
            aria-describedby={descId}
            autoComplete={autoComplete}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
        )}
      </FieldShell>
      <div ref={listRef} hidden={!open} className="enter-fade-up pt-1.5">
        <div
          id={listId}
          role="listbox"
          aria-label="Suggested addresses"
          // Hairline edge like the field's, so the card also reads inside
          // another card and in dark mode (no card shadow there).
          className="list-card ring-[0.5px] ring-sep"
        >
          {items.map((s, i) => {
            const place = [s.city, [s.state, s.zip].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                aria-label={s.label}
                // Keep focus (and the phone keyboard) in the input; pick on click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") choose(s);
                }}
                onPointerMove={(e) => {
                  if (e.pointerType === "mouse" && active !== i) setActive(i);
                }}
                className={cx(
                  "list-row row-press flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5 [--sep-inset:46px]",
                  i === active && "bg-fill-2",
                )}
              >
                <MapPin
                  aria-hidden
                  size={18}
                  className="shrink-0 text-label-2"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">
                    {s.street}
                  </span>
                  {place && (
                    <span className="block truncate text-subhead text-label-2">
                      {place}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {credit && (
          <p className="px-4 pt-1 text-caption text-label-2">{credit}</p>
        )}
      </div>
      {message ? (
        <FieldError id={descId}>{message}</FieldError>
      ) : hint ? (
        <p id={descId} className="px-1 pt-1 text-footnote text-label-2">
          {hint}
        </p>
      ) : null}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {open && count > 0
          ? `${count} ${count === 1 ? "address" : "addresses"} found`
          : ""}
      </span>
    </div>
  );
}
