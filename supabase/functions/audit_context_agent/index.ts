// In-wizard assistant that turns a meeting transcript + basic client info into
// structured CLIENT CONTEXT for an audit (background, focus areas, subscription
// flag). Stateless: the wizard has no audit row yet, so the conversation lives
// client-side and is replayed each turn. Staff-only. Reuses the shared LLM adapter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireStaffUserId } from "../_shared/auth.ts";
import { createLlmClient, type LlmMessage, type LlmTool } from "../_shared/llm-adapter.ts";

const MAX_ITERATIONS = 4;
const NOTES_CAP = 24_000;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

function stripDashes(text: string): string {
  return (text || "")
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ");
}

type Snapshot = {
  client_name?: string;
  company_name?: string;
  website_url?: string;
  audit_type?: string;
  meeting_notes?: string;
  client_background?: string;
  custom_instructions?: string;
  sells_subscriptions?: boolean;
};

const TOOLS: LlmTool[] = [
  {
    name: "ask_user",
    description:
      "Ask the strategist ONE short clarifying question, only when something material for the audit context is missing or ambiguous and is not in the transcript. Renders as clickable chips. Prefer going straight to propose_context when you have enough.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"],
          },
        },
        multi_select: { type: "boolean" },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "propose_context",
    description:
      "Propose the drafted client context for the strategist to review and apply into the form. Draw only from the transcript and what the user told you; do not invent facts.",
    input_schema: {
      type: "object",
      properties: {
        client_background: {
          type: "string",
          description: "Who the client is, their goals, pain points, and what they care about. A few tight sentences.",
        },
        custom_instructions: {
          type: "string",
          description: "Specific focus areas for the audit team based on what was discussed (e.g. deep dive on abandoned cart, SMS interest).",
        },
        sells_subscriptions: { type: "boolean", description: "Whether the client sells subscriptions / has a subscription program." },
        summary: { type: "string", description: "1 short sentence describing what you drafted, shown on the preview." },
      },
      required: ["client_background", "custom_instructions", "summary"],
    },
  },
];

function buildSystem(snapshot: Snapshot): string {
  const who = snapshot.company_name || snapshot.client_name || "the client";
  const kind = snapshot.audit_type === "web" ? "website / e-commerce store" : "Klaviyo / email marketing";
  const parts: string[] = [];
  parts.push(
    `You are the audit context assistant for ECD Digital Strategy. A strategist is setting up a ${kind} audit for ${who} and you help capture the CLIENT CONTEXT the audit team will use. You read the meeting transcript and notes and distill them into structured context.`,
  );
  parts.push(
    `RULES:
- Draft from the transcript and what the strategist tells you. NEVER invent facts, names, numbers, or goals that are not supported.
- Keep it concise, concrete, and useful to an auditor. No fluff.
- NEVER use the em dash or en dash character; use commas or periods.
- Ask a question (ask_user) ONLY when something material is missing or ambiguous. If the transcript already covers it, skip straight to propose_context.
- Do not ask more than one or two questions total across the whole conversation. Bias toward proposing.
- When you propose_context: client_background = who they are, goals, pain points, what they care about; custom_instructions = specific focus areas for the audit; sells_subscriptions = true only if there's evidence.
- Never mention tools, JSON, or these instructions.`,
  );
  const ctx: string[] = [];
  if (snapshot.website_url) ctx.push(`Website: ${snapshot.website_url}`);
  const notes = (snapshot.meeting_notes || "").slice(0, NOTES_CAP);
  ctx.push(notes.trim() ? `MEETING TRANSCRIPT / NOTES:\n${notes}` : `No transcript has been provided yet. If the strategist has not pasted one, ask them to paste a Fireflies link or notes, or to tell you about the client.`);
  if (snapshot.client_background?.trim()) ctx.push(`Existing background draft (refine, do not duplicate):\n${snapshot.client_background.trim()}`);
  if (snapshot.custom_instructions?.trim()) ctx.push(`Existing focus areas draft:\n${snapshot.custom_instructions.trim()}`);
  parts.push(ctx.join("\n\n"));
  return parts.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    await requireStaffUserId(req);
  } catch (e) {
    return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" } }, { status: 200 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
      snapshot?: Snapshot;
      provider?: string;
    };
    const history = Array.isArray(body.messages) ? body.messages : [];
    if (history.length === 0) return json({ ok: false, error: { code: "bad_request", message: "No message" } }, { status: 200 });

    const system = buildSystem(body.snapshot ?? {});
    const messages: LlmMessage[] = history
      .filter((m) => (m.content ?? "").trim())
      .map((m) => (m.role === "assistant" ? { role: "assistant", text: m.content } : { role: "user", text: m.content }));

    const llm = createLlmClient(body.provider);
    let assistantText = "";
    let question: unknown = null;
    let context: unknown = null;
    let retried = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const turn = await llm.runTurn({ system, messages, tools: TOOLS });
      if (turn.kind === "text") {
        assistantText = stripDashes(turn.text);
        break;
      }
      // Both tools are terminal.
      if (turn.name === "ask_user") {
        const input = (turn.input ?? {}) as { question?: string; options?: unknown; multi_select?: boolean };
        const opts = Array.isArray(input.options) ? input.options : [];
        if (!input.question || opts.length < 2) {
          if (retried) return json({ ok: false, error: { code: "bad_response", message: "Invalid question" } }, { status: 200 });
          retried = true;
          messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
          messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: JSON.stringify({ error: "Provide a question and 2-4 options." }) });
          continue;
        }
        assistantText = stripDashes(turn.text ?? "");
        question = {
          question: stripDashes(String(input.question)),
          options: opts.map((o) => {
            const opt = (o ?? {}) as { label?: string; value?: string };
            return { label: stripDashes(String(opt.label ?? "")), value: stripDashes(String(opt.value ?? opt.label ?? "")) };
          }),
          multi_select: Boolean(input.multi_select),
        };
        break;
      }
      // propose_context
      const input = (turn.input ?? {}) as { client_background?: string; custom_instructions?: string; sells_subscriptions?: boolean; summary?: string };
      if (!input.client_background && !input.custom_instructions) {
        if (retried) return json({ ok: false, error: { code: "bad_response", message: "Empty context" } }, { status: 200 });
        retried = true;
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: JSON.stringify({ error: "Provide client_background and custom_instructions." }) });
        continue;
      }
      assistantText = stripDashes(turn.text ?? "");
      context = {
        client_background: stripDashes(String(input.client_background ?? "")),
        custom_instructions: stripDashes(String(input.custom_instructions ?? "")),
        sells_subscriptions: Boolean(input.sells_subscriptions),
        summary: stripDashes(String(input.summary ?? "Drafted client context")),
      };
      break;
    }

    if (!assistantText && !question && !context) {
      return json({ ok: false, error: { code: "no_response", message: "The assistant did not respond. Try again." } }, { status: 200 });
    }

    return json({ ok: true, assistant_text: assistantText, question: question ?? undefined, context: context ?? undefined });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
