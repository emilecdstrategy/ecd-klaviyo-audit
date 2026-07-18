// Shared "memory" helpers for the proposal and document AI agents:
//  - reading the house voice/style profile from platform_settings
//  - reading a durable, model-written memory blob from ai_memory
//  - scheduling a background step that updates that memory after a draft/edits
//
// Memory is automatic and hidden: written only here (service role), read into the
// agent system prompt. Never authoritative over live structured data.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { LlmClient } from "./llm-adapter.ts";

const MEMORY_CHAR_CAP = 2000;

function stripDashes(text: string): string {
  return (text || "")
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/[–—]/g, ", ");
}

export async function readVoiceProfile(
  sb: SupabaseClient,
  settingsColumn: "proposal_settings" | "document_settings",
): Promise<string> {
  const { data } = await sb.from("platform_settings").select(settingsColumn).eq("id", "default").maybeSingle();
  const settings = (data?.[settingsColumn] ?? {}) as { voice_profile?: unknown };
  return typeof settings.voice_profile === "string" ? settings.voice_profile.trim() : "";
}

export async function readMemory(sb: SupabaseClient, scopeKey: string | null): Promise<string> {
  if (!scopeKey) return "";
  const { data } = await sb.from("ai_memory").select("memory").eq("scope_key", scopeKey).maybeSingle();
  return typeof data?.memory === "string" ? data.memory.trim() : "";
}

/** After a turn that produced a draft/edits, merge the new activity into the
 * durable memory for this scope. Runs in the background (best-effort). */
export function scheduleMemoryUpdate(args: {
  sb: SupabaseClient;
  llm: LlmClient;
  scopeKey: string | null;
  subject: string; // e.g. "client" or "the documents you write"
  priorMemory: string;
  userMessage: string;
  producedSummary: string;
}): void {
  const { sb, llm, scopeKey, subject, priorMemory, userMessage, producedSummary } = args;
  if (!scopeKey) return;

  const task = (async () => {
    try {
      const system = `You maintain a compact, durable MEMORY about how this team works with ${subject}. You are given the existing memory and a new piece of activity. Return an updated memory that merges them.

Rules:
- Keep only durable, reusable facts: preferences, tone and formatting asks, pricing philosophy, recurring scope choices, things to always do or avoid, and stable facts about the relationship.
- Drop one-off details, dates, and anything specific to a single deliverable.
- Deduplicate and keep it tight: under ${MEMORY_CHAR_CAP} characters, plain short lines or bullets.
- NEVER use the em dash or en dash character.
- If the new activity adds nothing durable, return the existing memory unchanged.
- Output ONLY the updated memory text, nothing else.`;
      const user = `EXISTING MEMORY:\n${priorMemory || "(empty)"}\n\nNEW ACTIVITY:\nUser asked: ${userMessage || "(no text)"}\nAssistant produced: ${producedSummary || "(a draft/edit)"}`;
      const turn = await llm.runTurn({ system, messages: [{ role: "user", text: user }], tools: [] });
      if (turn.kind !== "text") return;
      const memory = stripDashes(turn.text).trim().slice(0, MEMORY_CHAR_CAP + 500);
      if (!memory) return;
      await sb
        .from("ai_memory")
        .upsert({ scope_key: scopeKey, memory, updated_at: new Date().toISOString() }, { onConflict: "scope_key" });
    } catch {
      // Memory is best-effort; never block or fail the turn.
    }
  })();

  const runtime = globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };
  if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(task);
  else void task;
}
