import { getSecret } from "./app-secrets.ts";

export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmImage = { url: string; label?: string };

export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "user_images"; text: string; images: LlmImage[] }
  | { role: "assistant"; text: string }
  | { role: "assistant_tool_call"; id: string; name: string; input: unknown; text?: string }
  | { role: "tool_result"; id: string; name: string; result: string };

export type LlmTurnResult =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown; text: string };

/** Force the model to call a specific tool this turn (structured output). */
export type LlmToolChoice = { type: "tool"; name: string };

export interface LlmClient {
  runTurn(args: {
    system: string;
    messages: LlmMessage[];
    tools: LlmTool[];
    toolChoice?: LlmToolChoice;
  }): Promise<LlmTurnResult>;
}

const REQUEST_TIMEOUT_MS = 110_000;
const MAX_ATTEMPTS = 2;

function timeoutSignal(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { signal, clear } = timeoutSignal(REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { raw: text };
      }
      if (!res.ok) {
        const msg = parsed?.error?.message ?? `LLM request failed (${res.status})`;
        const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 529;
        if (retryable && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(msg);
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        throw new Error(`${msg} (status ${res.status})`);
      }
      return parsed;
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
      if (isAbort && attempt < MAX_ATTEMPTS) {
        lastErr = new Error("LLM request timed out");
        continue;
      }
      if (isAbort) throw new Error("LLM request timed out");
      throw e;
    } finally {
      clear();
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM request failed");
}

// --- Anthropic ------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-opus-4-8";

function toAnthropicMessages(messages: LlmMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.text }] });
    } else if (m.role === "user_images") {
      const content: unknown[] = [];
      for (const img of m.images) {
        if (img.label) content.push({ type: "text", text: img.label });
        content.push({ type: "image", source: { type: "url", url: img.url } });
      }
      if (m.text) content.push({ type: "text", text: m.text });
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: [{ type: "text", text: m.text }] });
    } else if (m.role === "assistant_tool_call") {
      const content: unknown[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      content.push({ type: "tool_use", id: m.id, name: m.name, input: m.input });
      out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.id, content: m.result }],
      });
    }
  }
  return out;
}

class AnthropicClient implements LlmClient {
  constructor(private readonly model: string = ANTHROPIC_MODEL) {}

  async runTurn(args: {
    system: string;
    messages: LlmMessage[];
    tools: LlmTool[];
    toolChoice?: LlmToolChoice;
  }): Promise<LlmTurnResult> {
    const apiKey = await getSecret("anthropic_api_key");
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 16000,
      system: args.system,
      messages: toAnthropicMessages(args.messages),
      tools: args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
    };
    if (args.toolChoice) body.tool_choice = { type: "tool", name: args.toolChoice.name };
    const res = await postJson(
      ANTHROPIC_URL,
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body,
    );
    const blocks: any[] = Array.isArray(res?.content) ? res.content : [];
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolUse = blocks.find((b) => b?.type === "tool_use");
    if (toolUse) {
      return { kind: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input, text };
    }
    return { kind: "text", text };
  }
}

// --- OpenAI (Responses API) -----------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = "gpt-5.4";

function toOpenAiInput(messages: LlmMessage[]) {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "input_text", text: m.text }] });
    } else if (m.role === "user_images") {
      const content: unknown[] = [];
      for (const img of m.images) {
        if (img.label) content.push({ type: "input_text", text: img.label });
        content.push({ type: "input_image", image_url: img.url });
      }
      if (m.text) content.push({ type: "input_text", text: m.text });
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: [{ type: "output_text", text: m.text }] });
    } else if (m.role === "assistant_tool_call") {
      if (m.text) out.push({ role: "assistant", content: [{ type: "output_text", text: m.text }] });
      out.push({ type: "function_call", call_id: m.id, name: m.name, arguments: JSON.stringify(m.input ?? {}) });
    } else {
      out.push({ type: "function_call_output", call_id: m.id, output: m.result });
    }
  }
  return out;
}

class OpenAiClient implements LlmClient {
  constructor(private readonly model: string = OPENAI_MODEL) {}

  async runTurn(args: {
    system: string;
    messages: LlmMessage[];
    tools: LlmTool[];
    toolChoice?: LlmToolChoice;
  }): Promise<LlmTurnResult> {
    const apiKey = await getSecret("openai_api_key");
    const body: Record<string, unknown> = {
      model: this.model,
      reasoning: { effort: "medium" },
      instructions: args.system,
      input: toOpenAiInput(args.messages),
      tools: args.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      })),
    };
    if (args.toolChoice) body.tool_choice = { type: "function", name: args.toolChoice.name };
    const res = await postJson(OPENAI_URL, { authorization: `Bearer ${apiKey}` }, body);
    const items: any[] = Array.isArray(res?.output) ? res.output : [];
    const text = items
      .filter((o) => o?.type === "message")
      .flatMap((o) => o?.content ?? [])
      .map((c: any) => c?.text)
      .filter((t: unknown) => typeof t === "string")
      .join("\n")
      .trim();
    const call = items.find((o) => o?.type === "function_call");
    if (call) {
      let input: unknown = {};
      try {
        input = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        input = {};
      }
      return { kind: "tool_call", id: call.call_id, name: call.name, input, text };
    }
    return { kind: "text", text };
  }
}

// ---------------------------------------------------------------------------

export function createLlmClient(provider?: string | null, opts?: { model?: string }): LlmClient {
  const chosen = (provider || Deno.env.get("PROPOSAL_AGENT_PROVIDER") || "anthropic").toLowerCase();
  if (chosen === "openai") return new OpenAiClient(opts?.model);
  return new AnthropicClient(opts?.model);
}
