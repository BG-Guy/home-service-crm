import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Deep link for sheets: when `?key=value` is in the URL (e.g. `/vehicles?new=vehicle`
 * from the global "+" menu), call `open()` once and drop the param.
 */
export function useOpenOnParam(
  key: string,
  value: string,
  open: () => void,
  enabled = true,
): void {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hit = enabled && params.get(key) === value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per param value
  useEffect(() => {
    if (!hit) return;
    open();
    const next = new URLSearchParams(params.toString());
    next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [hit]);
}
