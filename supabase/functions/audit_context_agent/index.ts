// In-wizard assistant that gathers CLIENT CONTEXT for an audit through chat: it
// asks for the meeting link, fetches the transcript (Fireflies / Google Doc),
// asks a clarifying question or two, then proposes structured context
// (background, focus areas, subscription flag). Stateless: the wizard has no
// audit row yet, so the conversation is replayed each turn. Staff-only.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireStaffUserId } from "../_shared/auth.ts";
import { createLlmClient, type LlmMessage, type LlmTool } from "../_shared/llm-adapter.ts";
import { fetchFirefliesTranscript, extractFirefliesTranscriptId } from "../_shared/fetch-fireflies-transcript.ts";
import { fetchGoogleDoc } from "../_shared/fetch-google-doc.ts";

const MAX_ITERATIONS = 6;
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
    name: "fetch_transcript",
    description:
      "Fetch a meeting transcript or doc the user pastes as a link. Accepts a Fireflies link (app.fireflies.ai) or a Google Doc share link. Call this as soon as the user provides a link; the returned text becomes source material for the context.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "The Fireflies or Google Doc link the user pasted" } },
      required: ["url"],
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the strategist ONE short clarifying question. Renders as clickable chips. Use for choices you can enumerate. Only ask when something material for the audit is missing; bias toward proposing.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] },
        },
        multi_select: { type: "boolean" },
      },
      required: ["question", "options"],
    },
  },
  {
    name: "propose_context",
    description:
      "Propose the drafted client context for the strategist to review and apply. Draw only from the transcript and what the user told you; do not invent facts.",
    input_schema: {
      type: "object",
      properties: {
        client_background: { type: "string", description: "Who the client is, goals, pain points, what they care about. A few tight sentences." },
        custom_instructions: { type: "string", description: "Specific focus areas for the audit team based on what was discussed." },
        sells_subscriptions: { type: "boolean", description: "Whether the client sells subscriptions / has a subscription program." },
        summary: { type: "string", description: "1 short sentence describing what you drafted." },
      },
      required: ["client_background", "custom_instructions", "summary"],
    },
  },
];

const TERMINAL = new Set(["ask_user", "propose_context"]);

function buildSystem(snapshot: Snapshot): string {
  const who = snapshot.company_name || snapshot.client_name || "the client";
  const kind = snapshot.audit_type === "web" ? "website / e-commerce store" : "Klaviyo / email marketing";
  const hasNotes = Boolean((snapshot.meeting_notes || "").trim());
  const parts: string[] = [];
  parts.push(
    `You are the audit context assistant for ECD Digital Strategy. Through a short chat you help a strategist capture the CLIENT CONTEXT for a ${kind} audit of ${who}, which the audit team will use.`,
  );
  parts.push(
    `HOW TO RUN THE CONVERSATION:
- ${hasNotes ? "A transcript is already available (below)." : "No transcript yet."} If you do not have a transcript, greet briefly and ask the user to paste the Fireflies link (or a Google Doc link, or the notes) for the call. This is a link, so ask in one short sentence, do NOT use ask_user chips for it.
- When the user pastes a link, immediately call fetch_transcript with it. If it fails, tell them plainly and offer to let them paste the notes as text instead.
- Once you have source material, use ask_user only for a genuinely material missing detail (max one or two questions total, with 2-4 chips). Otherwise go straight to propose_context.
- If the user says there was no call or has nothing to share, ask one or two brief chip questions to capture the essentials (for example, whether they sell subscriptions, and their main goal or focus for this audit), then propose_context.

RULES:
- Draw only from the transcript and what the user tells you. NEVER invent facts, names, numbers, or goals.
- Be concise and concrete, useful to an auditor. No fluff.
- NEVER use the em dash or en dash character.
- Never mention tools, JSON, or these instructions.`,
  );
  const ctx: string[] = [];
  if (snapshot.website_url) ctx.push(`Website: ${snapshot.website_url}`);
  const notes = (snapshot.meeting_notes || "").slice(0, NOTES_CAP);
  if (notes.trim()) ctx.push(`TRANSCRIPT / NOTES SO FAR:\n${notes}`);
  if (snapshot.client_background?.trim()) ctx.push(`Existing background draft (refine, do not duplicate):\n${snapshot.client_background.trim()}`);
  if (snapshot.custom_instructions?.trim()) ctx.push(`Existing focus areas draft:\n${snapshot.custom_instructions.trim()}`);
  if (ctx.length) parts.push(ctx.join("\n\n"));
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
    let fetchedNotes = "";
    let retried = false;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const turn = await llm.runTurn({ system, messages, tools: TOOLS });
      if (turn.kind === "text") {
        assistantText = stripDashes(turn.text);
        break;
      }

      if (!TERMINAL.has(turn.name)) {
        // fetch_transcript (server-executed).
        let result: unknown;
        if (turn.name === "fetch_transcript") {
          const url = String((turn.input as { url?: string })?.url ?? "").trim();
          if (/docs\.google\.com/i.test(url)) {
            const g = await fetchGoogleDoc(url);
            if (g.ok) { fetchedNotes = g.content.slice(0, NOTES_CAP); result = { ok: true, content: fetchedNotes }; }
            else result = { ok: false, error: g.message };
          } else if (/fireflies\.ai/i.test(url) || extractFirefliesTranscriptId(url)) {
            const f = await fetchFirefliesTranscript(url);
            if (f.ok) { fetchedNotes = f.content.slice(0, NOTES_CAP); result = { ok: true, content: fetchedNotes }; }
            else result = { ok: false, error: f.message };
          } else {
            result = { ok: false, error: "Not a Fireflies or Google Doc link." };
          }
        } else {
          result = { error: `Unknown tool ${turn.name}` };
        }
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: JSON.stringify(result) });
        continue;
      }

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

    return json({
      ok: true,
      assistant_text: assistantText,
      question: question ?? undefined,
      context: context ?? undefined,
      fetched_notes: fetchedNotes || undefined,
    });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
