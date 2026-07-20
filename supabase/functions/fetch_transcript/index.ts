// Fetch a meeting transcript (Fireflies) or a Google Doc from a link, for the
// audit wizard's Client Context step. Staff-only; the Fireflies API key is a
// server secret so this must run server-side. Mirrors what the proposal/document
// AI assistants already do via their tools.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireStaffUserId } from "../_shared/auth.ts";
import { fetchFirefliesTranscript, extractFirefliesTranscriptId } from "../_shared/fetch-fireflies-transcript.ts";
import { fetchGoogleDoc } from "../_shared/fetch-google-doc.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  try {
    await requireStaffUserId(req);
  } catch (e) {
    return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" } }, { status: 200 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = (body.url ?? "").trim();
    if (!url) return json({ ok: false, error: { code: "bad_request", message: "Paste a link first." } }, { status: 200 });

    const isGoogleDoc = /docs\.google\.com/i.test(url);
    const isFireflies = /fireflies\.ai/i.test(url) || extractFirefliesTranscriptId(url) !== null;

    if (isGoogleDoc) {
      const fetched = await fetchGoogleDoc(url);
      if (!fetched.ok) {
        return json({ ok: false, error: { code: "fetch_failed", message: fetched.message ?? "Could not read that Google Doc." } }, { status: 200 });
      }
      return json({ ok: true, content: fetched.content, title: "" });
    }

    if (isFireflies) {
      const fetched = await fetchFirefliesTranscript(url);
      if (!fetched.ok) {
        return json({ ok: false, error: { code: fetched.error_code, message: fetched.message } }, { status: 200 });
      }
      return json({ ok: true, content: fetched.content, title: fetched.title, truncated: fetched.truncated });
    }

    return json(
      { ok: false, error: { code: "invalid_url", message: "Paste a Fireflies transcript link or a Google Doc link." } },
      { status: 200 },
    );
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});
