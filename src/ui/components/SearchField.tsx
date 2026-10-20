"use client";

import { CircleX, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cx } from "../cx";

/**
 * Search pill with clear and Cancel (DESIGN.md §5): 44 px, `--card` with a soft
 * shadow on the canvas, the `--field` fill inside cards and sheets (automatic).
 * `onSearch` is debounced (200 ms). With `param`, the query is mirrored into the
 * URL (`?q=`) via `router.replace` so server-rendered lists can filter on
 * `searchParams`. `sticky` pins it under the nav bar with a raised shadow.
 *
 * ```tsx
 * // page.tsx (server): <SearchField param="q" defaultValue={sp.q} placeholder="Search customers" />
 * ```
 */
export function SearchField({
  defaultValue = "",
  onSearch,
  param,
  placeholder = "Search",
  label,
  debounceMs = 200,
  showCancel = true,
  autoFocus,
  onCancel,
  sticky,
  className,
}: {
  defaultValue?: string;
  /** Debounced callback with the trimmed query. */
  onSearch?: (q: string) => void;
  /** Search-param name to sync (e.g. "q"). Resets "cursor" on change. */
  param?: string;
  placeholder?: string;
  /** Accessible label (defaults to the placeholder). */
  label?: string;
  debounceMs?: number;
  /** Show the iOS "Cancel" button while focused (mobile). */
  showCancel?: boolean;
  autoFocus?: boolean;
  onCancel?: () => void;
  /** Stick under the nav bar (list pages). */
  sticky?: boolean;
  className?: string;
}) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(defaultValue.trim());

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed === last.current) return;
    last.current = trimmed;
    onSearch?.(trimmed);
    if (param) {
      const sp = new URLSearchParams(window.location.search);
      if (trimmed) sp.set(param, trimmed);
      else sp.delete(param);
      sp.delete("cursor");
      const qs = sp.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }
  };

  const schedule = (q: string, delay = debounceMs) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(q), delay);
  };

  const clear = () => {
    setValue("");
    schedule("", 0);
    inputRef.current?.focus();
  };

  return (
    <search
      className={cx(
        "flex items-center gap-2",
        sticky && "search-sticky",
        className,
      )}
    >
      <div className="search-pill relative flex h-11 min-w-0 flex-1 items-center rounded-pill">
        <Search
          aria-hidden
          size={18}
          strokeWidth={2.25}
          className="pointer-events-none absolute left-3.5 text-label-2"
        />
        <label htmlFor={id} className="sr-only">
          {label ?? placeholder}
        </label>
        <input
          ref={inputRef}
          id={id}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: opt-in by the caller
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          aria-busy={pending || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            schedule(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              schedule(value, 0);
              e.currentTarget.blur();
            } else if (e.key === "Escape" && value) {
              e.preventDefault();
              clear();
            }
          }}
          className="h-full w-full min-w-0 bg-transparent pl-10 pr-10 text-body text-label outline-none placeholder:text-label-2 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onPointerDown={(e) => e.preventDefault()}
            onClick={clear}
            className="absolute right-1 flex size-10 items-center justify-center rounded-full text-label-3"
          >
            <CircleX
              aria-hidden
              size={17}
              fill="currentColor"
              stroke="var(--card)"
            />
          </button>
        )}
      </div>
      {showCancel && focused && (
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            setValue("");
            schedule("", 0);
            inputRef.current?.blur();
            onCancel?.();
          }}
          className="enter-fade-up min-h-11 shrink-0 px-1 text-body text-accent-text lg:hidden"
        >
          Cancel
        </button>
      )}
    </search>
  );
}
