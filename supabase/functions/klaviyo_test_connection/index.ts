import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
    ...init,
  });
}

const KLAVIYO_REVISION = "2024-10-15";

async function klaviyoCall(apiKey: string, path: string) {
  const res = await fetch(`https://a.klaviyo.com${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
    },
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

function mapErrorCode(status: number): string {
  if (status === 401) return "invalid_key";
  if (status === 403) return "insufficient_scope";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unknown_error";
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  try {
    const { apiKey } = (await req.json()) as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string") return json({ error: "Missing apiKey" }, { status: 400 });

    const accountRes = await klaviyoCall(apiKey, "/api/accounts/?page[size]=1");
    if (!accountRes.ok) {
      return json({
        ok: false,
        revision: KLAVIYO_REVISION,
        error: {
          code: mapErrorCode(accountRes.status),
          message: "Failed account access",
          status: accountRes.status,
        },
      }, { status: 200 });
    }

    const listsRes = await klaviyoCall(apiKey, "/api/lists/?page[size]=1");
    const campaignsRes = await klaviyoCall(apiKey, "/api/campaigns/?page[size]=1");

    const accountData = (accountRes.body as any)?.data?.[0] ?? null;
    return json({
      ok: true,
      revision: KLAVIYO_REVISION,
      account: accountData
        ? {
            id: accountData.id ?? null,
            name: accountData.attributes?.contact_information?.organization_name ?? null,
            timezone: accountData.attributes?.timezone ?? null,
          }
        : null,
      scopeChecks: {
        accountsRead: accountRes.ok,
        listsRead: listsRes.ok,
        campaignsRead: campaignsRes.ok,
      },
      warnings: [
        !listsRes.ok ? `List scope may be missing (${listsRes.status})` : null,
        !campaignsRes.ok ? `Campaign scope may be missing (${campaignsRes.status})` : null,
      ].filter(Boolean),
    }, { status: 200 });
  } catch (e) {
    return json({
      ok: false,
      error: {
        code: "request_failed",
        message: e instanceof Error ? e.message : "Unknown error",
      },
    }, { status: 200 });
  }
});

