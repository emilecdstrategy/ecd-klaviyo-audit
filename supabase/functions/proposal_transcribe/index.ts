import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getUserIdFromAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";

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

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await getUserIdFromAuthorization(req);

    const input = (await req.json()) as { audio_base64?: string; mime?: string };
    const b64 = (input.audio_base64 ?? "").trim();
    const mime = (input.mime ?? "audio/webm").trim() || "audio/webm";
    if (!b64) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audio" }, correlationId }, { status: 400 });
    }

    const bytes = b64decode(b64);
    if (bytes.byteLength === 0) {
      return json({ ok: false, error: { code: "bad_request", message: "Empty audio" }, correlationId }, { status: 400 });
    }
    // OpenAI transcription hard limit is 25MB.
    if (bytes.byteLength > 25 * 1024 * 1024) {
      return json({ ok: false, error: { code: "too_large", message: "Recording is too long." }, correlationId }, { status: 400 });
    }

    const apiKey = await getSecret("openai_api_key");

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `audio.${extForMime(mime)}`);
    form.append("model", "whisper-1");
    form.append("language", "en");
    form.append("response_format", "json");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) {
      return json(
        { ok: false, error: { code: "openai_error", message: `Transcription failed (${res.status})`, detail: text.slice(0, 200) }, correlationId },
        { status: 200 },
      );
    }
    let transcript = "";
    try {
      transcript = (JSON.parse(text) as { text?: string }).text ?? "";
    } catch {
      transcript = text;
    }
    return json({ ok: true, text: transcript.trim(), correlationId }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const unauthorized = /session|authorization/i.test(message);
    return json(
      { ok: false, error: { code: unauthorized ? "unauthorized" : "request_failed", message }, correlationId },
      { status: unauthorized ? 401 : 200 },
    );
  }
});
