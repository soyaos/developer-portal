// Tiny className joiner so we don't pull in `clsx` / `tailwind-merge` for
// the alpha. Filters out falsy values and joins with a single space.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
