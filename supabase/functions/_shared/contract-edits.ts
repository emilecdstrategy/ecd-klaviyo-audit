// Redline-style edits to a contract's text.
//
// The proposal assistant used to tailor a contract by sending the ENTIRE
// rewritten document back through the model. The MSA is 5,400 words, so a
// request for three redlines meant generating 9,000+ tokens of unchanged legal
// text, which cannot finish inside the edge runtime's 150s wall clock: three
// attempts in a row died as 504s with "Edge Function returned a non-2xx status
// code" as the only clue. Now the model sends the excerpt it wants changed and
// the replacement, and the full text is assembled here in a millisecond.
//
// A find must match exactly once. Zero matches means the model paraphrased
// instead of quoting, and the error goes back to it to fix; more than one means
// the excerpt is too short to be safe to touch.

export type ContractEdit = { find: string; replace: string };

export type ApplyResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/** Collapse runs of whitespace so a quote that differs only in line breaks or
 * double spaces still lands on the intended passage. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** Find `needle` in `hay` allowing whitespace to differ, returning the exact
 * [start, end) span in the original text, or every candidate start if there
 * are several. */
function locate(hay: string, needle: string): number[] {
  const exact: number[] = [];
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    exact.push(idx);
    idx = hay.indexOf(needle, idx + 1);
  }
  if (exact.length > 0) return exact;

  // Whitespace-tolerant: build a regex from the needle's tokens.
  const tokens = normalizeWs(needle).trim().split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const re = new RegExp(pattern, "g");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) {
    out.push(m.index);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function spanLength(hay: string, start: number, needle: string): number {
  if (hay.startsWith(needle, start)) return needle.length;
  const tokens = normalizeWs(needle).trim().split(" ").filter(Boolean);
  const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const m = new RegExp(pattern).exec(hay.slice(start));
  return m ? m[0].length : needle.length;
}

export function applyContractEdits(base: string, edits: ContractEdit[]): ApplyResult {
  let content = base;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const find = String(e?.find ?? "");
    const replace = String(e?.replace ?? "");
    if (find.trim().length < 8) {
      return { ok: false, error: `contract_edits[${i}].find is too short to identify a passage safely; quote at least a full phrase` };
    }
    const hits = locate(content, find);
    if (hits.length === 0) {
      return {
        ok: false,
        error: `contract_edits[${i}].find was not found in the contract. Quote the passage VERBATIM from get_contracts, including punctuation: "${find.slice(0, 120)}"`,
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        error: `contract_edits[${i}].find matches ${hits.length} places in the contract; quote a longer passage so it matches exactly once`,
      };
    }
    const start = hits[0];
    const len = spanLength(content, start, find);
    content = content.slice(0, start) + replace + content.slice(start + len);
  }
  if (content.trim().length < 40) return { ok: false, error: "the edited contract would be empty" };
  return { ok: true, content };
}
