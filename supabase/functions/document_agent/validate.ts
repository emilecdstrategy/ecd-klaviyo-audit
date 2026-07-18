// Validation + copy sanitizing for the document agent payloads.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Remove em/en dashes from generated copy. */
export function sanitizeCopy(input: string): string {
  if (!input) return input;
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ");
}

export function stripInternalNotes(input: string): string {
  if (!input) return input;
  return input
    .replace(
      /^[ \t]*\[(?:Asked the user|Proposed a draft|Proposed edits|Proposed a set of edits|Source content fetched)[^\]]*\][ \t]*$/gim,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function deepSanitize<T>(value: T): T {
  if (typeof value === "string") return sanitizeCopy(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepSanitize(v);
    return out as unknown as T;
  }
  return value;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

export function validateQuestion(input: any): ValidationResult<{
  question: string;
  options: Array<{ label: string; value: string }>;
  allow_other: true;
  multi_select: boolean;
}> {
  if (!input || typeof input !== "object") return { ok: false, error: "ask_user input must be an object" };
  if (!isStr(input.question) || !input.question.trim()) return { ok: false, error: "ask_user.question is required" };
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4) {
    return { ok: false, error: "ask_user.options must have 2-4 entries" };
  }
  for (const o of input.options) {
    if (!o || !isStr(o.label) || !isStr(o.value) || !o.label.trim() || !o.value.trim()) {
      return { ok: false, error: "each ask_user option needs a non-empty label and value" };
    }
  }
  return {
    ok: true,
    value: {
      question: input.question.trim(),
      options: input.options.map((o: any) => ({ label: o.label.trim(), value: o.value.trim() })),
      allow_other: true,
      multi_select: Boolean(input.multi_select),
    },
  };
}

export function validateDraft(input: any): ValidationResult<{ title: string; content: string; summary: string; include_sender_signature: boolean }> {
  if (!input || typeof input !== "object") return { ok: false, error: "propose_draft input must be an object" };
  if (!isStr(input.title) || !input.title.trim()) return { ok: false, error: "title is required" };
  if (!isStr(input.content) || !input.content.trim()) return { ok: false, error: "content is required" };
  if (!isStr(input.summary) || !input.summary.trim()) return { ok: false, error: "summary is required" };
  return {
    ok: true,
    value: {
      title: input.title,
      content: input.content,
      summary: input.summary,
      include_sender_signature: Boolean(input.include_sender_signature),
    },
  };
}

export function validateEdits(input: any): ValidationResult<{ content: string; summary: string }> {
  if (!input || typeof input !== "object") return { ok: false, error: "propose_edits input must be an object" };
  if (!isStr(input.content) || !input.content.trim()) return { ok: false, error: "content is required" };
  if (!isStr(input.summary) || !input.summary.trim()) return { ok: false, error: "summary is required" };
  return { ok: true, value: { content: input.content, summary: input.summary } };
}
