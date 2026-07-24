import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireStaffUserId, assertServiceRoleClient } from "../_shared/auth.ts";
import { createLlmClient, type LlmImage, type LlmMessage, type LlmTool } from "../_shared/llm-adapter.ts";
import { FINDINGS_GUARDRAILS } from "../_shared/ecommerce-ux-kb.ts";

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

const WEB_MODEL = "claude-sonnet-5";
const dash = (s: unknown) => String(s ?? "").replace(/\s*[—–]\s*/g, ", ").trim();

// The page sections the assistant can edit, with their capture page_type.
const PAGE_SECTIONS: Array<{ key: string; page_type: string; label: string }> = [
  { key: "web_homepage", page_type: "homepage", label: "Homepage" },
  { key: "web_product_page", page_type: "product", label: "Product page" },
  { key: "web_collection_page", page_type: "collection", label: "Collection page" },
  { key: "web_cart", page_type: "cart", label: "Cart" },
];
const SECTION_KEYS = PAGE_SECTIONS.map((s) => s.key);

type Finding = { text?: string; recommendation?: string; viewport?: string; hidden?: boolean };
type SectionRow = { id: string; section_key: string; summary_text: string | null; section_details: Record<string, unknown> | null };

function webFindings(section: SectionRow): Finding[] {
  const web = (section.section_details?.web ?? {}) as { findings?: Finding[] };
  return Array.isArray(web.findings) ? web.findings : [];
}

const ASK_USER_TOOL: LlmTool = {
  name: "ask_user",
  description: "Ask the strategist a short clarifying question when it is unclear which section to edit or what change they want. Offer 2-4 concrete options.",
  input_schema: {
    type: "object",
    required: ["question", "options"],
    properties: {
      question: { type: "string" },
      options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    },
  },
};

const PROPOSE_TOOL: LlmTool = {
  name: "propose_section_edits",
  description: "Propose a set of edits to ONE page section's findings and/or its summary. The strategist reviews and applies them.",
  input_schema: {
    type: "object",
    required: ["section_key", "summary", "operations"],
    properties: {
      section_key: { type: "string", enum: SECTION_KEYS, description: "Which section these edits apply to." },
      summary: { type: "string", description: "One short sentence describing what this change does, for the preview." },
      section_summary: { type: "string", description: "Optional: a new section summary paragraph to replace the current one." },
      operations: {
        type: "array",
        description: "Findings edits, applied in order. Indexes refer to the section's current findings list (0-based).",
        items: {
          type: "object",
          required: ["op"],
          properties: {
            op: { type: "string", enum: ["add_finding", "update_finding", "remove_finding"] },
            index: { type: "number", description: "For update_finding / remove_finding: the 0-based index of the finding." },
            text: { type: "string", description: "The problem, one short plain-English sentence." },
            recommendation: { type: "string", description: "The fix in 1-2 sentences: the concrete change plus why it helps. Founder-friendly, no jargon." },
            viewport: { type: "string", enum: ["desktop", "mobile", "both"], description: "Which device this finding is about." },
          },
        },
      },
    },
  },
};

const REGENERATE_TOOL: LlmTool = {
  name: "regenerate_section",
  description: "Redo a whole section's findings from scratch (a fresh AI pass over that page's screenshots), optionally steered by the strategist's focus. Use this when they want the section re-done rather than a few tweaks.",
  input_schema: {
    type: "object",
    required: ["section_key", "summary"],
    properties: {
      section_key: { type: "string", enum: SECTION_KEYS, description: "Which section to regenerate." },
      instruction: { type: "string", description: "Optional focus to steer the regeneration (e.g. 'lean into trust and social proof')." },
      summary: { type: "string", description: "One short sentence describing what this will do, for the preview." },
    },
  },
};

function buildSystemPrompt(): string {
  return `You are the editing assistant for ECD Digital Strategy's website (Shopify storefront) audit reports. A strategist is reviewing an audit and wants you to adjust the findings and recommendations for a page.

VOICE: write like a sharp, friendly senior strategist talking to a founder, not a QA engineer. Plain English, no jargon (never "tap target", "above the fold", "CTA", "viewport"). Each FINDING is one short sentence naming the problem; each RECOMMENDATION is 1-2 sentences that name the concrete, Shopify-feasible change AND why it helps conversion, AOV, or trust. Never use the em dash or en dash.

GUARDRAILS:
${FINDINGS_GUARDRAILS}

HOW YOU WORK:
- You edit ONE page section per proposal. Figure out which section the strategist means from their message and the section contents provided. If it is genuinely unclear, call ask_user with concrete options (list the section names).
- Use the provided screenshots and existing findings to keep edits grounded and specific. Do not invent features, prices, or facts.
- Findings must be genuine improvement opportunities. Never add a "keep as is" or praise-only finding.
- When you have a concrete change to specific findings, call propose_section_edits with the operations. Index-based operations (update_finding, remove_finding) refer to the CURRENT findings list shown to you (0-based). add_finding appends.
- When the strategist wants a whole section redone from scratch (e.g. "redo the cart findings", "regenerate the homepage focused on trust"), call regenerate_section instead of enumerating operations.
- If the strategist is just chatting or asking a question, reply in plain text without calling a tool.

Call at most one tool per turn.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  let body: { audit_id?: string; message?: string; history?: Array<{ role: string; content: string }> };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Invalid JSON" } }, { status: 400 });
  }
  const auditId = (body.audit_id ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!auditId || !message) return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or message" } }, { status: 400 });

  try {
    await requireStaffUserId(req);
  } catch (e) {
    return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" } }, { status: 401 });
  }

  try {
    const sb = assertServiceRoleClient();
    const { data: audit } = await sb.from("audits").select("id, client_id, audit_type, context").eq("id", auditId).maybeSingle();
    if (!audit) return json({ ok: false, error: { code: "not_found" } }, { status: 404 });
    if (audit.audit_type !== "web") return json({ ok: false, error: { code: "not_web_audit" } }, { status: 400 });

    const { data: sectionRows } = await sb
      .from("audit_sections")
      .select("id, section_key, summary_text, section_details")
      .eq("audit_id", auditId)
      .in("section_key", SECTION_KEYS);
    const sections = (sectionRows ?? []) as SectionRow[];
    const byKey = new Map(sections.map((s) => [s.section_key, s]));

    // Compact text of every page section's current findings, so the model can
    // target the right one and edit by index.
    const sectionsDigest = PAGE_SECTIONS.map((meta) => {
      const s = byKey.get(meta.key);
      if (!s) return `## ${meta.label} (${meta.key}) - not captured`;
      const findings = webFindings(s)
        .map((f, i) => `  [${i}] (${f.viewport ?? "both"}) ${f.text ?? ""}${f.recommendation ? ` => ${f.recommendation}` : ""}`)
        .join("\n");
      return `## ${meta.label} (${meta.key})\nSummary: ${s.summary_text ?? "(none)"}\nFindings:\n${findings || "  (none)"}`;
    }).join("\n\n");

    // Grounding screenshots: the desktop above-the-fold shot of each page section.
    const { data: snaps } = await sb
      .from("web_page_snapshots")
      .select("page_type, viewport, variant, status, screenshot_url")
      .eq("audit_id", auditId)
      .eq("status", "success")
      .not("screenshot_url", "is", null);
    const images: LlmImage[] = [];
    for (const meta of PAGE_SECTIONS) {
      const rows = (snaps ?? []).filter((r: Record<string, unknown>) => r.page_type === meta.page_type);
      const shot = rows.find((r: Record<string, unknown>) => r.viewport === "desktop" && r.variant === "viewport")
        ?? rows.find((r: Record<string, unknown>) => r.viewport === "desktop")
        ?? rows[0];
      if (shot?.screenshot_url) images.push({ url: shot.screenshot_url as string, label: `${meta.label} (desktop)` });
    }

    const ctx = (audit.context ?? {}) as { client_background?: string; custom_instructions?: string };
    const contextText = [
      ctx.client_background ? `Client background: ${ctx.client_background}` : "",
      ctx.custom_instructions ? `Audit focus areas: ${ctx.custom_instructions}` : "",
    ].filter(Boolean).join("\n");

    const messages: LlmMessage[] = [];
    for (const h of (body.history ?? []).slice(-10)) {
      if (h.role === "user" || h.role === "assistant") messages.push({ role: h.role, text: String(h.content ?? "").slice(0, 4000) });
    }
    const taskText = `Current audit sections and their findings:\n\n${sectionsDigest}\n\n${contextText ? contextText + "\n\n" : ""}Strategist's request:\n${message}`;
    messages.push(images.length ? { role: "user_images", text: taskText, images } : { role: "user", text: taskText });

    const llm = createLlmClient("anthropic", { model: WEB_MODEL });
    const system = buildSystemPrompt();

    const runOnce = () => llm.runTurn({ system, messages, tools: [ASK_USER_TOOL, PROPOSE_TOOL, REGENERATE_TOOL] });
    let turn = await runOnce();

    if (turn.kind === "text") {
      return json({ ok: true, assistant_text: dash(turn.text) });
    }

    // Tool call: validate and shape the response.
    const validateAndBuild = (name: string, input: Record<string, unknown>): { question?: unknown; edits?: unknown; regenerate?: unknown; error?: string } => {
      if (name === "regenerate_section") {
        const sectionKey = String(input.section_key ?? "");
        if (!SECTION_KEYS.includes(sectionKey)) return { error: `section_key must be one of ${SECTION_KEYS.join(", ")}` };
        const meta = PAGE_SECTIONS.find((m) => m.key === sectionKey)!;
        return { regenerate: { section_key: sectionKey, section_title: meta.label, instruction: input.instruction != null ? dash(input.instruction) : undefined, summary: dash(input.summary) } };
      }
      if (name === "ask_user") {
        const q = dash(input.question);
        const options = Array.isArray(input.options) ? input.options.map(dash).filter(Boolean).slice(0, 4) : [];
        if (!q || options.length < 2) return { error: "ask_user needs a question and 2-4 options" };
        return { question: { question: q, options } };
      }
      if (name === "propose_section_edits") {
        const sectionKey = String(input.section_key ?? "");
        if (!SECTION_KEYS.includes(sectionKey)) return { error: `section_key must be one of ${SECTION_KEYS.join(", ")}` };
        const section = byKey.get(sectionKey);
        const count = section ? webFindings(section).length : 0;
        const rawOps = Array.isArray(input.operations) ? input.operations : [];
        const operations: Array<Record<string, unknown>> = [];
        for (const raw of rawOps) {
          const o = (raw ?? {}) as Record<string, unknown>;
          const op = String(o.op ?? "");
          const vp = ["desktop", "mobile", "both"].includes(String(o.viewport)) ? String(o.viewport) : "both";
          if (op === "add_finding") {
            const text = dash(o.text);
            if (!text) return { error: "add_finding needs text" };
            operations.push({ op, text, recommendation: dash(o.recommendation), viewport: vp });
          } else if (op === "update_finding" || op === "remove_finding") {
            const index = Number(o.index);
            if (!Number.isInteger(index) || index < 0 || index >= count) return { error: `${op} index ${o.index} is out of range (0-${count - 1})` };
            if (op === "remove_finding") operations.push({ op, index });
            else operations.push({ op, index, text: o.text != null ? dash(o.text) : undefined, recommendation: o.recommendation != null ? dash(o.recommendation) : undefined, viewport: o.viewport != null ? vp : undefined });
          } else {
            return { error: `unknown op: ${op}` };
          }
        }
        const sectionSummary = input.section_summary != null ? dash(input.section_summary) : undefined;
        if (operations.length === 0 && !sectionSummary) return { error: "propose at least one operation or a section_summary" };
        const meta = PAGE_SECTIONS.find((m) => m.key === sectionKey)!;
        return { edits: { section_key: sectionKey, section_title: meta.label, summary: dash(input.summary), section_summary: sectionSummary, operations } };
      }
      return { error: `unknown tool: ${name}` };
    };

    let built = validateAndBuild(turn.name, (turn.input ?? {}) as Record<string, unknown>);
    // One retry: feed the validation error back so the model can fix it.
    if (built.error) {
      messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input });
      messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: `Invalid: ${built.error}. Please call the tool again with valid values.` });
      turn = await runOnce();
      if (turn.kind === "text") return json({ ok: true, assistant_text: dash(turn.text) });
      built = validateAndBuild(turn.name, (turn.input ?? {}) as Record<string, unknown>);
      if (built.error) return json({ ok: false, error: { code: "invalid_proposal", message: built.error } }, { status: 200 });
    }

    return json({ ok: true, assistant_text: dash(turn.text), question: built.question, edits: built.edits, regenerate: built.regenerate });
  } catch (e) {
    return json({ ok: false, error: { code: "agent_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
