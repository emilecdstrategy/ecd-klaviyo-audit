import type { LlmTool } from "./llm-adapter.ts";
import { normalizeToArray } from "./tool-payload.ts";

// The ask_user tool shared by the proposal and document assistants. One call can
// carry up to four questions; the panel walks the user through them one at a
// time and sends every answer back in a single message.

export const MAX_QUESTIONS = 4;

export type AskUserOption = { label: string; value: string };
export type AskUserItem = { question: string; options: AskUserOption[]; multi_select: boolean };

/** The first question sits at the top level, so a payload stored before
 * multi-question support and one stored after read the same way. `questions`
 * is only present when there are two or more. */
export type AskUserPayload = AskUserItem & { allow_other: true; questions?: AskUserItem[] };

type Result = { ok: true; value: AskUserPayload } | { ok: false; error: string };

const OPTIONS_SCHEMA = {
  type: "array",
  minItems: 2,
  maxItems: 4,
  items: {
    type: "object",
    properties: {
      label: { type: "string", description: "Short chip label, 1-6 words" },
      value: { type: "string", description: "The full answer text sent back when this chip is clicked" },
    },
    required: ["label", "value"],
  },
};

/** `whenToAsk` is the assistant-specific sentence on when a question is worth asking. */
export function askUserTool(whenToAsk: string): LlmTool {
  return {
    name: "ask_user",
    description:
      "Ask the user clarifying questions with 2-4 concrete options each, rendered as clickable chips (plus an automatic free-text 'Other'). " +
      "ALWAYS use this tool to ask a question, including simple yes/no questions (give Yes and No as the two options). This is the only way the user gets clickable answers. Never ask a question as plain chat text. " +
      "For ONE decision, set question and options. When SEVERAL independent decisions are open at once (for example a few scope gaps to settle), set questions instead, one entry per decision, most important first, up to 4. " +
      "The user answers them one after another and all the answers come back together in one message. " +
      whenToAsk +
      " This ends your turn.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One clear question, a single sentence. Use for a single decision." },
        options: OPTIONS_SCHEMA,
        multi_select: { type: "boolean", description: "Allow selecting multiple options" },
        questions: {
          type: "array",
          minItems: 2,
          maxItems: MAX_QUESTIONS,
          description: "Several independent questions asked in sequence. Use instead of question/options when there are 2 or more decisions to make.",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "One clear question, a single sentence, understandable on its own" },
              options: OPTIONS_SCHEMA,
              multi_select: { type: "boolean", description: "Allow selecting multiple options" },
            },
            required: ["question", "options"],
          },
        },
      },
    },
  };
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

/** A short, readable chip for an option that only gave its full answer text. */
function chipLabel(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 57);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + "...";
}

function validateItem(input: any, label: string): { ok: true; value: AskUserItem } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: `${label} must be an object` };
  if (!isStr(input.question) || !input.question.trim()) return { ok: false, error: `${label}.question is required` };

  // The schema asks for 2 to 4 options, and the model usually obliges. What
  // arrives otherwise is worth repairing rather than refusing: the panel renders
  // any number of chips and always offers a free-text "Other", so a single
  // usable option is a working question, and an error is not.
  const normalized = normalizeToArray(input.options);
  if (normalized === null) {
    return {
      ok: false,
      error:
        `${label}.options could not be read as a list of choices. Send it as a JSON array of { label, value } objects, ` +
        "not as text and not as function-call markup.",
    };
  }

  const options: AskUserOption[] = [];
  for (const entry of normalized) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const chip = isStr(row.label) ? row.label.trim() : "";
    const value = isStr(row.value) ? row.value.trim() : "";
    if (!chip && !value) continue;
    // A chip whose label is the whole answer is fine, and so is the reverse:
    // the label is what the user reads, the value is what they send back.
    options.push({ label: chip || chipLabel(value), value: value || chip });
  }

  // Markup recovery can strand the last option's value as a sibling key of the
  // payload, because that is where the model's broken syntax left it.
  const stray = isStr(input.value) ? input.value.trim() : "";
  const last = options[options.length - 1];
  if (stray && last && last.value === last.label) last.value = stray;

  if (options.length === 0) {
    return { ok: false, error: `${label}.options needs at least one option with a label and an answer value` };
  }

  return {
    ok: true,
    value: {
      question: input.question.trim(),
      // More than a handful of chips is a menu, not a question. Keep the first
      // few rather than failing; "Other" covers anything dropped.
      options: options.slice(0, 6),
      multi_select: Boolean(input.multi_select),
    },
  };
}

export function validateQuestion(input: any): Result {
  if (!input || typeof input !== "object") return { ok: false, error: "ask_user input must be an object" };

  const items: AskUserItem[] = [];
  let firstError: string | null = null;
  const list = input.questions == null ? null : normalizeToArray(input.questions);
  if (list) {
    list.forEach((entry, i) => {
      const r = validateItem(entry, `ask_user.questions[${i}]`);
      if (r.ok) items.push(r.value);
      else firstError ??= r.error;
    });
  }
  // A lone top-level question still counts, whether or not questions was sent:
  // the model sometimes puts the first one at the top and the rest in the list.
  if (isStr(input.question) && input.question.trim()) {
    const r = validateItem(input, "ask_user");
    if (r.ok && !items.some((q) => q.question === r.value.question)) items.unshift(r.value);
    else if (!r.ok) firstError ??= r.error;
  }

  if (items.length === 0) {
    return { ok: false, error: firstError ?? "ask_user needs a question with options, or a questions list" };
  }

  const kept = items.slice(0, MAX_QUESTIONS);
  const [first] = kept;
  return {
    ok: true,
    value: {
      ...first,
      allow_other: true,
      ...(kept.length > 1 ? { questions: kept } : {}),
    },
  };
}
