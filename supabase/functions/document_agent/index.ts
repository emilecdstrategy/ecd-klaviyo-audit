import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { createLlmClient, type LlmMessage } from "../_shared/llm-adapter.ts";
import { fetchGoogleDoc } from "../_shared/fetch-google-doc.ts";
import { fetchFirefliesTranscript } from "../_shared/fetch-fireflies-transcript.ts";
import { buildSystemPrompt, type DocumentSnapshot } from "./prompt.ts";
import { AGENT_TOOLS, TERMINAL_TOOLS } from "./tools.ts";
import { deepSanitize, sanitizeCopy, stripInternalNotes, validateDraft, validateEdits, validateQuestion } from "./validate.ts";

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 30;
const DOC_CONTENT_CHAR_CAP = 24_000;
const ATTACH_FALLBACK_TEXT = "Please review the attached file(s) and use them as source material.";

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

type AgentAttachment = { url: string; name: string; media_type: string; size?: number };

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  payload: any;
  payload_kind: string | null;
  actor_user_id: string | null;
  attachments: AgentAttachment[] | null;
  created_at: string;
};

function attachmentsToDocuments(atts: AgentAttachment[]) {
  return atts.filter((a) => a?.url).map((a) => ({ url: a.url, media_type: a.media_type || "application/pdf", name: a.name }));
}

function historyToLlmMessages(rows: MessageRow[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      const atts = Array.isArray(row.attachments) ? row.attachments : [];
      if (atts.length > 0) {
        out.push({ role: "user_docs", text: row.content || ATTACH_FALLBACK_TEXT, documents: attachmentsToDocuments(atts) });
      } else {
        out.push({ role: "user", text: row.content });
      }
    } else if (row.role === "assistant") {
      const text = (row.content || "").trim();
      if (text) out.push({ role: "assistant", text });
    } else if (row.role === "tool") {
      if (row.payload_kind === "doc_fetch" && row.payload?.ok && row.payload?.content) {
        out.push({ role: "user", text: `[Source content fetched earlier in this conversation]\n${row.payload.content}` });
      }
    }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  let uid: string;
  try {
    uid = await requireStaffUserId(req);
  } catch (e) {
    return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" } }, { status: 200 });
  }

  try {
    const body = (await req.json()) as {
      conversation_id?: string;
      document_id?: string;
      message?: string;
      attachments?: AgentAttachment[];
      snapshot?: DocumentSnapshot;
      provider?: string;
    };
    const message = (body.message ?? "").trim();
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).filter((a) => a && typeof a.url === "string" && a.url);
    if (!message && attachments.length === 0) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing message" } }, { status: 200 });
    }

    const sb = assertServiceRoleClient();

    // Load or create the conversation.
    let conversationId = body.conversation_id ?? null;
    let conversationWasCreated = false;
    if (!conversationId && body.document_id) {
      const { data } = await sb
        .from("document_agent_conversations")
        .select("id")
        .eq("document_id", body.document_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = data?.id ?? null;
    }
    if (!conversationId) {
      const { data, error } = await sb
        .from("document_agent_conversations")
        .insert({
          document_id: body.document_id ?? null,
          title: (message || attachments[0]?.name || "New document chat").slice(0, 80),
          created_by: uid,
        })
        .select("id")
        .single();
      if (error) throw error;
      conversationId = data.id as string;
      conversationWasCreated = true;
    }

    const { error: userInsertErr } = await sb.from("document_agent_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
      actor_user_id: uid,
      attachments,
    });
    if (userInsertErr) throw userInsertErr;

    const { data: historyRows, error: historyErr } = await sb
      .from("document_agent_messages")
      .select("id, role, content, payload, payload_kind, actor_user_id, attachments, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (historyErr) throw historyErr;
    const rows = ((historyRows ?? []) as MessageRow[]).reverse();

    const snapshot = body.snapshot ?? null;
    const mode: "draft" | "edit" = snapshot ? "edit" : "draft";
    const system = buildSystemPrompt({ mode, snapshot });
    const tools = AGENT_TOOLS.filter((t) => (t.name === "propose_edits" ? mode === "edit" : true));

    const llm = createLlmClient(body.provider);
    const priorRows = rows.length > 0 && rows[rows.length - 1].role === "user" ? rows.slice(0, -1) : rows;
    const messages: LlmMessage[] = historyToLlmMessages(priorRows);
    if (attachments.length > 0) {
      messages.push({ role: "user_docs", text: message || ATTACH_FALLBACK_TEXT, documents: attachmentsToDocuments(attachments) });
    } else {
      messages.push({ role: "user", text: message });
    }

    let assistantText = "";
    let question: unknown = null;
    let draft: unknown = null;
    let edits: unknown = null;
    let retriedValidation = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const turn = await llm.runTurn({ system, messages, tools });

      if (turn.kind === "text") {
        assistantText = stripInternalNotes(sanitizeCopy(turn.text));
        break;
      }

      if (!TERMINAL_TOOLS.has(turn.name)) {
        let result: unknown;
        let payloadKind = "catalog";
        if (turn.name === "fetch_google_doc") {
          payloadKind = "doc_fetch";
          const fetched = await fetchGoogleDoc((turn.input as { url?: string })?.url ?? "");
          result = fetched.ok && fetched.content.length > DOC_CONTENT_CHAR_CAP
            ? { ...fetched, content: fetched.content.slice(0, DOC_CONTENT_CHAR_CAP), truncated: true }
            : fetched;
        } else if (turn.name === "fetch_fireflies_transcript") {
          payloadKind = "doc_fetch";
          const fetched = await fetchFirefliesTranscript((turn.input as { url?: string })?.url ?? "");
          result = fetched.ok && fetched.content.length > DOC_CONTENT_CHAR_CAP
            ? { ...fetched, content: fetched.content.slice(0, DOC_CONTENT_CHAR_CAP), truncated: true }
            : fetched;
        } else if (turn.name === "get_templates") {
          const { data } = await sb
            .from("document_templates")
            .select("name, content")
            .eq("is_active", true)
            .order("display_order", { ascending: true });
          result = (data ?? []).map((t: any) => ({
            name: t.name,
            content: typeof t.content === "string" ? t.content.slice(0, 4000) : "",
          }));
        } else {
          result = { error: `Unknown tool ${turn.name}` };
        }
        await sb.from("document_agent_messages").insert({
          conversation_id: conversationId,
          role: "tool",
          content: turn.name,
          payload: result,
          payload_kind: payloadKind,
        });
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: JSON.stringify(result) });
        continue;
      }

      // Terminal tool: validate, sanitize, finish.
      let validation: { ok: true; value: unknown } | { ok: false; error: string };
      if (turn.name === "ask_user") validation = validateQuestion(turn.input);
      else if (turn.name === "propose_draft") validation = validateDraft(turn.input);
      else validation = validateEdits(turn.input);

      if (!validation.ok) {
        if (retriedValidation) {
          return json({ ok: false, error: { code: "bad_response", message: `Invalid ${turn.name}: ${validation.error}` } }, { status: 200 });
        }
        retriedValidation = true;
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: JSON.stringify({ error: `Invalid input: ${validation.error}. Fix and call ${turn.name} again.` }) });
        continue;
      }

      assistantText = stripInternalNotes(sanitizeCopy(turn.text ?? ""));
      const clean = deepSanitize(validation.value);
      if (turn.name === "ask_user") question = clean;
      else if (turn.name === "propose_draft") draft = clean;
      else edits = clean;
      break;
    }

    if (!assistantText && !question && !draft && !edits) {
      return json({ ok: false, error: { code: "no_response", message: "The assistant did not produce a response. Try rephrasing." } }, { status: 200 });
    }

    const payloadKind = question ? "question" : draft ? "draft" : edits ? "edits" : null;
    const { data: assistantRow, error: assistantErr } = await sb
      .from("document_agent_messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: assistantText,
        payload: question ?? draft ?? edits ?? null,
        payload_kind: payloadKind,
      })
      .select("id, created_at")
      .single();
    if (assistantErr) throw assistantErr;

    await sb.from("document_agent_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

    if (conversationWasCreated) {
      const convId = conversationId;
      const summary = (draft as { summary?: string })?.summary ?? (edits as { summary?: string })?.summary ?? assistantText;
      const titleTask = (async () => {
        try {
          const titleTurn = await llm.runTurn({
            system: "You generate a very short title (3 to 6 words, Title Case, no surrounding quotes, no trailing punctuation) summarizing what a document chat is about. Reply with ONLY the title.",
            messages: [{ role: "user", text: `First message: ${message}${summary ? `\nAssistant summary: ${summary}` : ""}` }],
            tools: [],
          });
          if (titleTurn.kind === "text") {
            const title = sanitizeCopy(titleTurn.text).replace(/^[\s"'#]+|[\s"']+$/g, "").slice(0, 80).trim();
            if (title) await sb.from("document_agent_conversations").update({ title }).eq("id", convId);
          }
        } catch { /* keep fallback title */ }
      })();
      const runtime = globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };
      if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(titleTask);
      else await titleTask;
    }

    return json({
      ok: true,
      conversation_id: conversationId,
      assistant_message_id: assistantRow.id,
      assistant_text: assistantText,
      question: question ?? undefined,
      draft: draft ?? undefined,
      edits: edits ?? undefined,
    });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
