import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getScreenshotProvider } from "../_shared/screenshot-provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STORAGE_BUCKET = "audit-assets";
const PAGE_TYPES = ["homepage", "product", "collection", "cart"] as const;
const VIEWPORTS = ["desktop", "mobile"] as const;
// Process at most this many captures per invocation, then chain-invoke self.
const BATCH_SIZE = 4;

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, accept, origin, referer, user-agent",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

function assertServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token && isServiceRoleAuthorization(token)) return;
  await getUserIdFromAuthorization(req);
}

function normalizePageUrl(raw: unknown): string | null {
  const url = String(raw ?? "").trim();
  if (!url) return null;
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    new URL(withProto);
    return withProto;
  } catch {
    return null;
  }
}

async function chainSelf(auditId: string, clientId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/web_capture_screenshots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId, client_id: clientId, continue: true }),
      }),
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);
  } catch {
    // best effort
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });

  const correlationId = crypto.randomUUID();
  try {
    await authorize(req);

    const input = (await req.json()) as {
      audit_id?: string;
      client_id?: string;
      pages?: Partial<Record<(typeof PAGE_TYPES)[number], string>>;
      continue?: boolean;
    };
    const auditId = (input.audit_id ?? "").trim();
    const clientId = (input.client_id ?? "").trim();
    if (!auditId || !clientId) {
      return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id or client_id" }, correlationId }, { status: 400 });
    }

    const sb = assertServiceClient();

    // Seed pending rows on the initial call (not on chained continuations).
    if (!input.continue) {
      const rows: Array<Record<string, unknown>> = [];
      for (const pageType of PAGE_TYPES) {
        const url = normalizePageUrl(input.pages?.[pageType]);
        if (!url) continue;
        for (const viewport of VIEWPORTS) {
          rows.push({
            audit_id: auditId,
            client_id: clientId,
            page_type: pageType,
            viewport,
            url,
            status: "pending",
          });
        }
      }
      if (rows.length === 0) {
        return json({ ok: false, error: { code: "bad_request", message: "No valid page URLs provided" }, correlationId }, { status: 400 });
      }
      // Idempotency: clear any prior snapshot rows for this audit before reseeding.
      await sb.from("web_page_snapshots").delete().eq("audit_id", auditId);
      const { error: insertErr } = await sb.from("web_page_snapshots").insert(rows);
      if (insertErr) throw insertErr;
    }

    const { data: pendingRows, error: pendingErr } = await sb
      .from("web_page_snapshots")
      .select("id, page_type, viewport, url")
      .eq("audit_id", auditId)
      .eq("status", "pending")
      .order("page_type", { ascending: true })
      .limit(BATCH_SIZE);
    if (pendingErr) throw pendingErr;

    if (!pendingRows?.length) {
      return json({ ok: true, correlationId, status: "complete", processed: 0 }, { status: 200 });
    }

    const provider = getScreenshotProvider();
    let processed = 0;

    for (const row of pendingRows) {
      const result = await provider.capture({ url: row.url, viewport: row.viewport as "desktop" | "mobile" });
      const now = new Date().toISOString();
      if (result.ok) {
        const path = `${clientId}/${auditId}/web/${row.page_type}_${row.viewport}.png`;
        const { error: uploadErr } = await sb.storage
          .from(STORAGE_BUCKET)
          .upload(path, result.png, { contentType: "image/png", upsert: true });
        if (uploadErr) {
          await sb.from("web_page_snapshots").update({
            status: "error",
            error_message: `upload_failed: ${uploadErr.message}`.slice(0, 500),
            fetched_at: now,
          }).eq("id", row.id);
        } else {
          const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
          await sb.from("web_page_snapshots").update({
            status: "success",
            screenshot_path: path,
            screenshot_url: pub?.publicUrl ?? null,
            error_message: null,
            fetched_at: now,
          }).eq("id", row.id);
        }
      } else {
        await sb.from("web_page_snapshots").update({
          status: "error",
          error_message: result.error.slice(0, 500),
          fetched_at: now,
        }).eq("id", row.id);
      }
      processed += 1;
    }

    // More pending? Chain another invocation so each stays inside the time budget.
    const { count } = await sb
      .from("web_page_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId)
      .eq("status", "pending");
    if ((count ?? 0) > 0) {
      await chainSelf(auditId, clientId);
      return json({ ok: true, correlationId, status: "in_progress", processed, remaining: count }, { status: 200 });
    }

    return json({ ok: true, correlationId, status: "complete", processed }, { status: 200 });
  } catch (e) {
    return json(
      { ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId },
      { status: 200 },
    );
  }
});
