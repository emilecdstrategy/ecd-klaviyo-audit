import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { assertServiceRoleClient, requireStaffUserId } from "../_shared/auth.ts";
import { createLlmClient, type LlmMessage } from "../_shared/llm-adapter.ts";
import { fetchGoogleDoc } from "../_shared/fetch-google-doc.ts";
import { fetchFirefliesTranscript } from "../_shared/fetch-fireflies-transcript.ts";
import { buildSystemPrompt, type AgentSnapshot } from "./prompt.ts";
import { AGENT_TOOLS, TERMINAL_TOOLS } from "./tools.ts";
import { deepSanitize, sanitizeCopy, validateDraft, validateEditSet, validateQuestion } from "./validate.ts";

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 30;
const DOC_CONTENT_CHAR_CAP = 24_000;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

type RequestBody = {
  conversation_id?: string;
  proposal_id?: string;
  client_id?: string;
  message?: string;
  snapshot?: AgentSnapshot;
  provider?: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  payload: any;
  payload_kind: string | null;
  actor_user_id: string | null;
  created_at: string;
};

function historyToLlmMessages(rows: MessageRow[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      out.push({ role: "user", text: row.content });
    } else if (row.role === "assistant") {
      let text = row.content || "";
      if (row.payload_kind === "question" && row.payload?.question) {
        text = `${text}\n[Asked the user: ${row.payload.question}]`.trim();
      } else if (row.payload_kind === "draft" && row.payload?.summary) {
        text = `${text}\n[Proposed a draft: ${row.payload.summary}]`.trim();
      } else if (row.payload_kind === "edits" && row.payload?.summary) {
        text = `${text}\n[Proposed edits: ${row.payload.summary}]`.trim();
      }
      if (text) out.push({ role: "assistant", text });
    } else if (row.role === "tool") {
      // Keep fetched document / transcript content available across turns; keep catalog results compact.
      if (row.payload_kind === "doc_fetch" && row.payload?.ok && row.payload?.content) {
        out.push({
          role: "user",
          text: `[Source content fetched earlier in this conversation]\n${row.payload.content}`,
        });
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
    return json(
      { ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" } },
      { status: 200 },
    );
  }

  try {
    const body = (await req.json()) as RequestBody;
    const message = (body.message ?? "").trim();
    if (!message) return json({ ok: false, error: { code: "bad_request", message: "Missing message" } }, { status: 200 });

    const sb = assertServiceRoleClient();

    // --- Load or create the conversation -----------------------------------
    let conversationId = body.conversation_id ?? null;
    let conversationWasCreated = false;
    if (!conversationId && body.proposal_id) {
      const { data } = await sb
        .from("proposal_agent_conversations")
        .select("id")
        .eq("proposal_id", body.proposal_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = data?.id ?? null;
    }
    if (!conversationId) {
      const { data, error } = await sb
        .from("proposal_agent_conversations")
        .insert({
          proposal_id: body.proposal_id ?? null,
          client_id: body.client_id ?? null,
          title: message.slice(0, 80),
          created_by: uid,
        })
        .select("id")
        .single();
      if (error) throw error;
      conversationId = data.id as string;
      conversationWasCreated = true;
    }

    // --- Persist the user message + load history ---------------------------
    const { error: userInsertErr } = await sb.from("proposal_agent_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: message,
      actor_user_id: uid,
    });
    if (userInsertErr) throw userInsertErr;

    const { data: historyRows, error: historyErr } = await sb
      .from("proposal_agent_messages")
      .select("id, role, content, payload, payload_kind, actor_user_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (historyErr) throw historyErr;
    const rows = ((historyRows ?? []) as MessageRow[]).reverse();

    // --- Context: contracts list + mode -------------------------------------
    const { data: contractRows } = await sb
      .from("contract_documents")
      .select("slug, name")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    const contracts = (contractRows ?? []) as Array<{ slug: string; name: string }>;

    const snapshot = body.snapshot ?? null;
    const mode: "draft" | "edit" = snapshot ? "edit" : "draft";

    let clientCompanyName: string | null = null;
    if (!snapshot && body.client_id) {
      const { data: c } = await sb.from("clients").select("company_name").eq("id", body.client_id).maybeSingle();
      clientCompanyName = c?.company_name ?? null;
    }

    const system = buildSystemPrompt({ mode, snapshot, contracts, clientCompanyName });
    const tools = AGENT_TOOLS.filter((t) => {
      if (t.name === "get_clients") return mode === "draft" && !body.client_id;
      if (t.name === "propose_edits") return mode === "edit";
      return true;
    });

    const llm = createLlmClient(body.provider);
    const messages: LlmMessage[] = historyToLlmMessages(rows);
    // The freshly inserted user message is included in `rows` already; if the
    // history got truncated to exclude it (very long chats), append it.
    if (messages.length === 0 || messages[messages.length - 1].role !== "user" ||
        (messages[messages.length - 1] as { text: string }).text !== message) {
      messages.push({ role: "user", text: message });
    }

    // --- Agent loop ----------------------------------------------------------
    let assistantText = "";
    let question: unknown = null;
    let draft: unknown = null;
    let edits: unknown = null;
    let retriedValidation = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const turn = await llm.runTurn({ system, messages, tools });

      if (turn.kind === "text") {
        assistantText = sanitizeCopy(turn.text);
        break;
      }

      if (!TERMINAL_TOOLS.has(turn.name)) {
        // Server-executed tool.
        let result: unknown;
        let payloadKind: string = "catalog";
        if (turn.name === "fetch_google_doc") {
          payloadKind = "doc_fetch";
          const url = (turn.input as { url?: string })?.url ?? "";
          const fetched = await fetchGoogleDoc(url);
          if (fetched.ok && fetched.content.length > DOC_CONTENT_CHAR_CAP) {
            result = { ...fetched, content: fetched.content.slice(0, DOC_CONTENT_CHAR_CAP), truncated: true };
          } else {
            result = fetched;
          }
        } else if (turn.name === "fetch_fireflies_transcript") {
          payloadKind = "doc_fetch";
          const url = (turn.input as { url?: string })?.url ?? "";
          const fetched = await fetchFirefliesTranscript(url);
          if (fetched.ok && fetched.content.length > DOC_CONTENT_CHAR_CAP) {
            result = { ...fetched, content: fetched.content.slice(0, DOC_CONTENT_CHAR_CAP), truncated: true };
          } else {
            result = fetched;
          }
        } else if (turn.name === "get_templates") {
          const { data } = await sb
            .from("proposal_templates")
            .select("name, content_blocks, default_line_items")
            .eq("is_active", true)
            .order("display_order", { ascending: true });
          result = (data ?? []).map((t: any) => ({
            name: t.name,
            section_titles: Array.isArray(t.content_blocks) ? t.content_blocks.map((b: any) => b?.title) : [],
            default_line_items: Array.isArray(t.default_line_items)
              ? t.default_line_items.map((li: any) => ({
                  name: li?.name,
                  description: li?.description,
                  one_time_price: li?.one_time_price ?? null,
                  one_time_label: li?.one_time_label ?? null,
                  monthly_price: li?.monthly_price ?? null,
                  monthly_label: li?.monthly_label ?? null,
                  content: typeof li?.content === "string" ? li.content.slice(0, 1500) : "",
                }))
              : [],
          }));
        } else if (turn.name === "get_contracts") {
          result = contracts;
        } else if (turn.name === "get_clients") {
          const { data, error } = await sb
            .from("clients")
            .select("id, company_name, name, website_url, email")
            .order("company_name", { ascending: true });
          if (error) throw error;
          result = (data ?? []).map((c: any) => ({
            id: c.id,
            company_name: c.company_name,
            contact_name: c.name ?? null,
            website_url: c.website_url ?? null,
            email: c.email ?? null,
          }));
        } else {
          result = { error: `Unknown tool ${turn.name}` };
        }

        const resultStr = JSON.stringify(result);
        await sb.from("proposal_agent_messages").insert({
          conversation_id: conversationId,
          role: "tool",
          content: turn.name,
          payload: result,
          payload_kind: payloadKind,
        });
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({ role: "tool_result", id: turn.id, name: turn.name, result: resultStr });
        continue;
      }

      // Terminal tool: validate, sanitize, finish.
      let validation:
        | { ok: true; value: unknown }
        | { ok: false; error: string };
      if (turn.name === "ask_user") {
        validation = validateQuestion(turn.input);
      } else if (turn.name === "propose_draft") {
        validation = validateDraft(turn.input);
      } else {
        validation = validateEditSet(turn.input, {
          blockKeys: new Set((snapshot?.proposal.content_blocks ?? []).map((b) => b.key)),
          itemIds: new Set((snapshot?.line_items ?? []).map((li) => li.id)),
          contractSlugs: new Set(contracts.map((c) => c.slug)),
        });
      }

      if (!validation.ok) {
        if (retriedValidation) {
          return json(
            { ok: false, error: { code: "bad_response", message: `The assistant produced an invalid ${turn.name} payload: ${validation.error}` } },
            { status: 200 },
          );
        }
        retriedValidation = true;
        messages.push({ role: "assistant_tool_call", id: turn.id, name: turn.name, input: turn.input, text: turn.text });
        messages.push({
          role: "tool_result",
          id: turn.id,
          name: turn.name,
          result: JSON.stringify({ error: `Invalid input: ${validation.error}. Fix the payload and call ${turn.name} again.` }),
        });
        continue;
      }

      assistantText = sanitizeCopy(turn.text ?? "");
      const clean = deepSanitize(validation.value);
      if (turn.name === "ask_user") question = clean;
      else if (turn.name === "propose_draft") draft = clean;
      else edits = clean;
      break;
    }

    if (!assistantText && !question && !draft && !edits) {
      return json(
        { ok: false, error: { code: "no_response", message: "The assistant did not produce a response. Try rephrasing." } },
        { status: 200 },
      );
    }

    const payloadKind = question ? "question" : draft ? "draft" : edits ? "edits" : null;
    const { data: assistantRow, error: assistantErr } = await sb
      .from("proposal_agent_messages")
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

    await sb
      .from("proposal_agent_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    // On the first turn, generate a concise AI title for the chat. Runs in the
    // background so it does not delay the response; falls back to the message
    // snippet already stored if it fails.
    if (conversationWasCreated) {
      const convId = conversationId;
      const summary =
        (draft as { summary?: string })?.summary ??
        (edits as { summary?: string })?.summary ??
        assistantText;
      const titleTask = (async () => {
        try {
          const titleTurn = await llm.runTurn({
            system:
              "You generate a very short title (3 to 6 words, Title Case, no surrounding quotes, no trailing punctuation) that summarizes what a client proposal chat is about. Reply with ONLY the title.",
            messages: [
              {
                role: "user",
                text: `First message: ${message}${summary ? `\nAssistant summary: ${summary}` : ""}`,
              },
            ],
            tools: [],
          });
          if (titleTurn.kind === "text") {
            const title = sanitizeCopy(titleTurn.text)
              .replace(/^[\s"'#]+|[\s"']+$/g, "")
              .slice(0, 80)
              .trim();
            if (title) {
              await sb.from("proposal_agent_conversations").update({ title }).eq("id", convId);
            }
          }
        } catch {
          // Keep the fallback message-snippet title.
        }
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
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } },
      { status: 200 },
    );
  }
});
