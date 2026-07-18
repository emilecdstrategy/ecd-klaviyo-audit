// Draft a "house voice & style" profile for the AI assistants by analyzing the
// agency's recent proposals (or documents). Staff-only. The result is shown in
// Settings for the user to review/edit before saving; nothing is persisted here.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { createLlmClient } from "../_shared/llm-adapter.ts";

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

const SAMPLE_CHAR_CAP = 14_000;

/** Strip em/en dashes to match the house no-dash rule. */
function sanitize(text: string): string {
  return (text || "")
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ")
    .trim();
}

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => {
      const title = typeof (b as { title?: string })?.title === "string" ? (b as { title: string }).title : "";
      const content = typeof (b as { content?: string })?.content === "string" ? (b as { content: string }).content : "";
      return [title, content].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
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
    const body = (await req.json().catch(() => ({}))) as { domain?: string; provider?: string };
    const domain = body.domain === "document" ? "document" : "proposal";
    const sb = assertServiceRoleClient();

    // Gather recent, meaningful samples.
    let samples: string[] = [];
    if (domain === "proposal") {
      const { data } = await sb
        .from("proposals")
        .select("title, content_blocks, status, created_at")
        .order("created_at", { ascending: false })
        .limit(15);
      const rows = (data ?? []) as Array<{ title: string; content_blocks: unknown; status: string }>;
      // Prefer proposals that were actually sent/won (real client-facing voice).
      const ordered = [
        ...rows.filter((r) => r.status === "won" || r.status === "sent" || r.status === "viewed"),
        ...rows.filter((r) => r.status !== "won" && r.status !== "sent" && r.status !== "viewed"),
      ];
      samples = ordered.map((r) => `# ${r.title}\n${blocksToText(r.content_blocks)}`).filter((s) => s.trim().length > 40);
    } else {
      const { data } = await sb
        .from("documents")
        .select("title, content, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (data ?? []) as Array<{ title: string; content: string }>;
      samples = rows
        .map((r) => `# ${r.title}\n${typeof r.content === "string" ? r.content : ""}`)
        .filter((s) => s.trim().length > 40);
    }

    if (samples.length === 0) {
      return json({ ok: true, voice_profile: "" });
    }

    // Cap the corpus we send to the model.
    let corpus = "";
    for (const s of samples) {
      if (corpus.length + s.length > SAMPLE_CHAR_CAP) break;
      corpus += (corpus ? "\n\n---\n\n" : "") + s;
    }

    const noun = domain === "proposal" ? "proposals" : "documents";
    const system = `You analyze an agency's past ${noun} and distill their house voice and writing style into a concise, reusable style guide that another writer (or an AI assistant) can follow to sound like this agency.

Output a practical guide, not a critique. Cover: overall tone and personality, sentence length and rhythm, formatting habits (headings, bullets, bolding), how they open and close, vocabulary they favor and words or phrases they avoid, and any structural conventions. Be specific and cite patterns you actually observe.

Rules:
- Write the guide as clear directives ("Use...", "Avoid...", "Open with...").
- Keep it under about 250 words.
- NEVER use the em dash or en dash character; use commas, periods, or "to" for ranges.
- Do not include client names, private facts, prices, or any content specific to one ${domain}. Describe style only.
- Output only the guide text, no preamble.`;

    const llm = createLlmClient(body.provider);
    const turn = await llm.runTurn({
      system,
      messages: [{ role: "user", text: `Here are recent ${noun}:\n\n${corpus}` }],
      tools: [],
    });

    const voice = turn.kind === "text" ? sanitize(turn.text) : "";
    return json({ ok: true, voice_profile: voice });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
