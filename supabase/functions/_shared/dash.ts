/**
 * House style: no em dashes or en dashes in anything a client reads.
 *
 * The rule was prompt-only on the Klaviyo path, and a prompt rule is a request
 * rather than a guarantee: the web pipeline and both chat agents each learned to
 * enforce it in code after the model ignored it. This is that same enforcement,
 * in one place, applied where copy is written rather than where it is generated.
 *
 * A dash between two numbers becomes a hyphen (a range stays a range); anywhere
 * else it becomes a comma, which is how the same substitution already works for
 * proposals, documents and web audits.
 */
export function sanitizeDash(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ")
    .trim();
}

/** sanitizeDash over every string in a value, structure preserved. Objects and
 *  arrays are walked; anything that is not a string is returned untouched. */
export function sanitizeDashDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeDash(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDashDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeDashDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
