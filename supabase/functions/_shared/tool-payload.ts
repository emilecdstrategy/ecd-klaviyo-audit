// Normalizing the shapes a model actually puts in a tool call, as opposed to the
// one the schema asks for.
//
// A proposal edit failed with "operations must be a non-empty array" twice in a
// row, which read as the assistant refusing to work. The array check is exact,
// but a large edit set sometimes arrives with the array JSON-encoded as a string,
// and a single edit sometimes arrives as a bare object. Both are unambiguous
// about what was meant, so both are accepted and reshaped rather than rejected.
//
// Anything genuinely unreadable still fails: this widens the accepted shapes, it
// does not guess at intent.

/** Coerce a list-shaped tool argument into an array.
 *  - an array passes through
 *  - a JSON string of an array, or of one object, is parsed
 *  - a single object becomes a one-item array
 *  - null/undefined/"" becomes an empty array (an explicit "nothing")
 *  Returns null when the value cannot be read as a list at all. */
export function normalizeToArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === "object") return [raw];
  return null;
}
