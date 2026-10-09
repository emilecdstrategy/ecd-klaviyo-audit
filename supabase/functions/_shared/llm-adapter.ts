import { getSecret } from "./app-secrets.ts";

export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmImage = { url: string; label?: string };
/** A document (e.g. PDF) attached to a user turn. Prefer `url`; base64 is a fallback. */
export type LlmDocument = { url?: string; base64?: string; media_type?: string; name?: string };

export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "user_images"; text: string; images: LlmImage[] }
  | { role: "user_docs"; text: string; documents: LlmDocument[] }
  | { role: "assistant"; text: string }
  // `raw` is the provider's own content for the turn (Anthropic: its thinking
  // blocks included). Pass it back from runTurn unchanged: Claude Opus 5.5 and
  // Sonnet 5.5 keep their reasoning across a tool loop only when its thinking
  // blocks come back as they were sent.
  | { role: "assistant_tool_call"; id: string; name: string; input: unknown; text?: string; raw?: unknown[] }
  | { role: "tool_result"; id: string; name: string; result: string };

export type LlmTurnResult =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown; text: string; raw?: unknown[] };

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
        // Anthropic reports a failure to fetch a caller-supplied image URL as a
        // 400, but "timed out while trying to download" is their fetcher having
        // a moment (or our storage responding slowly), not a bad request: the
        // identical call succeeds seconds later. Treating it as terminal paused
        // a whole audit for a human click. Longer backoff than the rate-limit
        // path, to give the slow storage read time to recover.
        const downloadHiccup = res.status === 400 &&
          /timed out while trying to download|error (while )?downloading|could not (be )?download|failed to download/i.test(msg);
        const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 529 ||
          downloadHiccup;
        if (retryable && attempt < MAX_ATTEMPTS) {
          lastErr = new Error(msg);
          await new Promise((r) => setTimeout(r, (downloadHiccup ? 2500 : 800) * attempt));
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
const ANTHROPIC_MODEL = "claude-opus-5-5";

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
    } else if (m.role === "user_docs") {
      const content: unknown[] = [];
      for (const doc of m.documents) {
        if (doc.name) content.push({ type: "text", text: `Attached file: ${doc.name}` });
        content.push({
          type: "document",
          source: doc.url
            ? { type: "url", url: doc.url }
            : { type: "base64", media_type: doc.media_type ?? "application/pdf", data: doc.base64 },
        });
      }
      if (m.text) content.push({ type: "text", text: m.text });
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      out.push({ role: "assistant", content: [{ type: "text", text: m.text }] });
    } else if (m.role === "assistant_tool_call" && m.raw?.length) {
      out.push({ role: "assistant", content: m.raw });
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
    const forced = args.toolChoice?.name;
    // Opus 5.5 and Sonnet 5.5 refuse a forced tool_choice. They are asked for
    // the tool instead, limited to one call, and asked again once if they
    // answer in text.
    const steer = forced && !acceptsForcedToolChoice(this.model);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 16000,
      system: steer
        ? `${args.system}\n\nRespond by calling the ${forced} tool exactly once. Do not answer in plain text.`
        : args.system,
      messages: toAnthropicMessages(args.messages),
      tools: args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      output_config: { effort: "medium" },
      // A safety classifier false positive is retried on Anthropic's
      // recommended model instead of failing the step.
      fallbacks: "default",
    };
    if (forced) {
      body.tool_choice = steer ? { type: "auto", disable_parallel_tool_use: true } : { type: "tool", name: forced };
    }
    const headers = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    };
    let res = await postJson(ANTHROPIC_URL, headers, body);
    if (steer && !hasToolUse(res, forced)) res = await postJson(ANTHROPIC_URL, headers, body);
    if (res?.stop_reason === "refusal") {
      const category = res?.stop_details?.category;
      throw new Error(`Claude declined this request${category ? ` (${category})` : ""}.`);
    }
    const blocks: any[] = Array.isArray(res?.content) ? res.content : [];
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolUse = blocks.find((b) => b?.type === "tool_use");
    if (toolUse) {
      // Keep only the first tool call: every caller answers one call per turn,
      // and a tool_use without its tool_result is a 400 on the next turn.
      const first = blocks.indexOf(toolUse);
      const raw = blocks.filter((b, i) => b?.type !== "tool_use" || i === first);
      return { kind: "tool_call", id: toolUse.id, name: toolUse.name, input: toolUse.input, text, raw };
    }
    return { kind: "text", text };
  }
}

/** Claude Opus 5.5, Sonnet 5.5 and the Fable / Mythos 5.1 line return a 400
 *  for tool_choice "tool" or "any"; earlier models accept it. */
function acceptsForcedToolChoice(model: string): boolean {
  return !/^claude-(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)/.test(model);
}

function hasToolUse(res: any, name: string): boolean {
  return Array.isArray(res?.content) && res.content.some((b: any) => b?.type === "tool_use" && b.name === name);
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
    } else if (m.role === "user_docs") {
      const content: unknown[] = [];
      for (const doc of m.documents) {
        if (doc.url) {
          content.push({ type: "input_file", file_url: doc.url });
        } else if (doc.base64) {
          content.push({
            type: "input_file",
            filename: doc.name ?? "file.pdf",
            file_data: `data:${doc.media_type ?? "application/pdf"};base64,${doc.base64}`,
          });
        }
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
      // Swallowing a parse failure here used to hand the caller a tool call with
      // an empty object for input, which every coercer happily turned into an
      // empty-but-valid result. A truncated or malformed payload has to surface.
      let input: unknown = {};
      try {
        input = call.arguments ? JSON.parse(call.arguments) : {};
      } catch (err) {
        throw new Error(`${call.name}: tool arguments were not valid JSON (${(err as Error).message}); received ${String(call.arguments ?? "").length} chars`);
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
