/** Join class names, skipping falsy values. (No clsx/tailwind-merge: SPEC §14.) */
export function cx(
  ...parts: Array<string | false | null | undefined | 0>
): string {
  let out = "";
  for (const p of parts) {
    if (p) out = out ? `${out} ${p}` : p;
  }
  return out;
}
