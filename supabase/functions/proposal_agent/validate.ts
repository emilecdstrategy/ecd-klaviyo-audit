// Hand-rolled validation + copy sanitizing for agent payloads.

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Remove em/en dashes from generated copy. Digit ranges become hyphens, prose becomes commas. */
export function sanitizeCopy(input: string): string {
  if (!input) return input;
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ");
}

/**
 * Strip internal history annotations the model sometimes echoes into its visible
 * reply (e.g. "[Asked the user: ...]"). Only applied to the chat text, never to
 * proposal payload content (which may legitimately contain [markdown](links)).
 */
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

/** Recursively sanitize every string in an object. */
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
function isNumOrNull(v: unknown): v is number | null {
  return v === null || v === undefined || typeof v === "number";
}
function isStrOrNull(v: unknown): v is string | null {
  return v === null || v === undefined || typeof v === "string";
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

function validateLineItem(item: any, label: string): string | null {
  if (!item || typeof item !== "object") return `${label} must be an object`;
  if (!isStr(item.name) || !item.name.trim()) return `${label}.name is required`;
  if (!isStr(item.description)) return `${label}.description must be a string`;
  if (!isStr(item.content)) return `${label}.content must be a string`;
  if (!isNumOrNull(item.one_time_price)) return `${label}.one_time_price must be a number or null`;
  if (!isNumOrNull(item.monthly_price)) return `${label}.monthly_price must be a number or null`;
  if (!isStrOrNull(item.one_time_label)) return `${label}.one_time_label must be a string or null`;
  if (!isStrOrNull(item.monthly_label)) return `${label}.monthly_label must be a string or null`;
  if (item.one_time_price == null && item.monthly_price == null) {
    return `${label} needs at least one of one_time_price or monthly_price`;
  }
  return null;
}

const DISCOUNT_TYPES = new Set(["none", "fixed", "percent"]);
const DISCOUNT_APPLIES = new Set(["one_time", "monthly", "both"]);

function validateDiscount(d: any): string | null {
  if (d == null) return null;
  if (typeof d !== "object") return "discount must be an object";
  if (!DISCOUNT_TYPES.has(d.type)) return "discount.type must be none|fixed|percent";
  if (typeof d.value !== "number" || d.value < 0) return "discount.value must be a non-negative number";
  if (!DISCOUNT_APPLIES.has(d.applies_to)) return "discount.applies_to must be one_time|monthly|both";
  if (!isStrOrNull(d.label)) return "discount.label must be a string or null";
  return null;
}

export function validateDraft(input: any): ValidationResult<any> {
  if (!input || typeof input !== "object") return { ok: false, error: "propose_draft input must be an object" };
  if (!isStr(input.title) || !input.title.trim()) return { ok: false, error: "title is required" };
  if (!isStr(input.summary) || !input.summary.trim()) return { ok: false, error: "summary is required" };
  if (!Array.isArray(input.content_blocks) || input.content_blocks.length === 0) {
    return { ok: false, error: "content_blocks must be a non-empty array" };
  }
  for (let i = 0; i < input.content_blocks.length; i++) {
    const b = input.content_blocks[i];
    if (!b || !isStr(b.title) || !b.title.trim() || !isStr(b.content)) {
      return { ok: false, error: `content_blocks[${i}] needs a title and markdown content` };
    }
  }
  if (!Array.isArray(input.line_items) || input.line_items.length === 0) {
    return { ok: false, error: "line_items must be a non-empty array" };
  }
  for (let i = 0; i < input.line_items.length; i++) {
    const err = validateLineItem(input.line_items[i], `line_items[${i}]`);
    if (err) return { ok: false, error: err };
  }
  const dErr = validateDiscount(input.discount);
  if (dErr) return { ok: false, error: dErr };
  if (input.include_contracts != null) {
    if (!Array.isArray(input.include_contracts) || input.include_contracts.some((s: unknown) => !isStr(s))) {
      return { ok: false, error: "include_contracts must be an array of slugs" };
    }
  }
  if (!isStrOrNull(input.client_id) || !isStrOrNull(input.recipient_name) || !isStrOrNull(input.recipient_email)) {
    return { ok: false, error: "client_id, recipient_name, recipient_email must be strings or null" };
  }
  return { ok: true, value: input };
}

const EDIT_OPS = new Set([
  "update_title",
  "update_block",
  "add_block",
  "remove_block",
  "add_line_item",
  "update_line_item",
  "delete_line_item",
  "update_discount",
  "toggle_contract",
  "update_recipient",
]);

export function validateEditSet(
  input: any,
  ctx: { blockKeys: Set<string>; itemIds: Set<string>; contractSlugs: Set<string> },
): ValidationResult<any> {
  if (!input || typeof input !== "object") return { ok: false, error: "propose_edits input must be an object" };
  if (!isStr(input.summary) || !input.summary.trim()) return { ok: false, error: "summary is required" };
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    return { ok: false, error: "operations must be a non-empty array" };
  }
  for (let i = 0; i < input.operations.length; i++) {
    const o = input.operations[i];
    const label = `operations[${i}]`;
    if (!o || typeof o !== "object" || !EDIT_OPS.has(o.op)) {
      return { ok: false, error: `${label}.op must be one of: ${[...EDIT_OPS].join(", ")}` };
    }
    switch (o.op) {
      case "update_title":
        if (!isStr(o.title) || !o.title.trim()) return { ok: false, error: `${label}: title is required` };
        break;
      case "update_block":
        if (!isStr(o.block_key) || !ctx.blockKeys.has(o.block_key)) {
          return { ok: false, error: `${label}: block_key must match an existing block key` };
        }
        if (o.title == null && o.content == null) {
          return { ok: false, error: `${label}: provide title and/or content` };
        }
        break;
      case "add_block":
        if (!isStr(o.title) || !o.title.trim() || !isStr(o.content)) {
          return { ok: false, error: `${label}: title and content are required` };
        }
        if (o.after_key != null && !ctx.blockKeys.has(o.after_key)) {
          return { ok: false, error: `${label}: after_key must match an existing block key or be null` };
        }
        break;
      case "remove_block":
        if (!isStr(o.block_key) || !ctx.blockKeys.has(o.block_key)) {
          return { ok: false, error: `${label}: block_key must match an existing block key` };
        }
        break;
      case "add_line_item": {
        const err = validateLineItem(o.item, `${label}.item`);
        if (err) return { ok: false, error: err };
        break;
      }
      case "update_line_item":
        if (!isStr(o.item_id) || !ctx.itemIds.has(o.item_id)) {
          return { ok: false, error: `${label}: item_id must match an existing line item id` };
        }
        if (!o.patch || typeof o.patch !== "object" || Object.keys(o.patch).length === 0) {
          return { ok: false, error: `${label}: patch must contain at least one field` };
        }
        break;
      case "delete_line_item":
        if (!isStr(o.item_id) || !ctx.itemIds.has(o.item_id)) {
          return { ok: false, error: `${label}: item_id must match an existing line item id` };
        }
        break;
      case "update_discount": {
        const err = validateDiscount(o.discount);
        if (err) return { ok: false, error: `${label}: ${err}` };
        if (o.discount == null) return { ok: false, error: `${label}: discount is required` };
        break;
      }
      case "toggle_contract":
        if (!isStr(o.slug) || !ctx.contractSlugs.has(o.slug)) {
          return { ok: false, error: `${label}: slug must be a known contract slug` };
        }
        if (typeof o.included !== "boolean") return { ok: false, error: `${label}: included must be boolean` };
        break;
      case "update_recipient":
        if (o.recipient_name == null && o.recipient_email == null) {
          return { ok: false, error: `${label}: provide recipient_name and/or recipient_email` };
        }
        break;
    }
  }
  return { ok: true, value: input };
}
