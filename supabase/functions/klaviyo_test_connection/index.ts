// Supabase Edge Function: klaviyo_test_connection
// Validates a Klaviyo Private API key by calling a lightweight endpoint.
// Configure no secrets here; key is provided by the client call.
//
// NOTE: This is a simple connectivity test. Do not log the key.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  try {
    const { apiKey } = (await req.json()) as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string") return json({ error: "Missing apiKey" }, { status: 400 });

    // Klaviyo v2024-10 style header. The exact version may vary; this is a connection smoke test.
    const res = await fetch("https://a.klaviyo.com/api/accounts/", {
      headers: {
        accept: "application/json",
        authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: "2024-10-15",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      return json({ ok: false, status: res.status, body: text.slice(0, 500) }, { status: 200 });
    }

    return json({ ok: true }, { status: 200 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 200 });
  }
});

