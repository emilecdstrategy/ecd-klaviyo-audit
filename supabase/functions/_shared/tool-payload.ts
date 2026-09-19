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

/** Records recovered from function-call markup that leaked into a string value.
 *
 * A model sometimes writes its OWN tool-call syntax inside a JSON string rather
 * than emitting JSON. An ask_user.options arrived as the string
 *   <parameter name="label">Phase 1 core</parameter>
 *   <parameter name="value">Phase it: ...</parameter>
 *   </invoke><invoke name="ask_user"><parameter name="label">Everything, trimmed
 * which is not an array, so the question died with "options must have 2-4
 * entries" and the user saw the assistant refuse a reasonable request. The
 * options are all there and unambiguous, so they are reshaped rather than
 * thrown away.
 *
 * A repeated key starts the next record, which is how a flat parameter list maps
 * back onto a list of objects. The final parameter is often truncated where the
 * model's markup ran out; it still carries its text, so it still counts. */
export function recoverLeakedParameters(raw: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};
  const flush = () => {
    if (Object.keys(current).length > 0) out.push(current);
    current = {};
  };
  const add = (key: string, value: string) => {
    const k = key.trim();
    const v = value.replace(/<\/?(?:invoke|function_calls|antml:[a-z_]+)[^>]*>/gi, "").trim();
    if (!k || !v) return;
    if (k in current) flush();
    current[k] = v;
  };

  const closed = /<parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/parameter>/gi;
  let match: RegExpExecArray | null;
  let after = 0;
  while ((match = closed.exec(raw)) !== null) {
    add(match[1], match[2]);
    after = closed.lastIndex;
  }
  const trailing = /<parameter\s+name\s*=\s*"([^"]*)"\s*>([\s\S]*)$/i.exec(raw.slice(after));
  if (trailing) add(trailing[1], trailing[2]);
  flush();
  return out;
}

/** Coerce a list-shaped tool argument into an array.
 *  - an array passes through
 *  - a JSON string of an array, or of one object, is parsed
 *  - leaked function-call markup is recovered into records
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
      // Not JSON. It may still be the model's own markup, handled below.
    }
    const recovered = recoverLeakedParameters(text);
    return recovered.length > 0 ? recovered : null;
  }
  if (typeof raw === "object") return [raw];
  return null;
}
