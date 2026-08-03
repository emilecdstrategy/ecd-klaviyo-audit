import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";
import { runHtmlAfter } from "../_shared/html-after.ts";
import type { Viewport } from "../_shared/after-image-prompt.ts";

// Test harness for the HTML "after" engine, and the runner behind the regression
// eval set. Takes a real page URL, a viewport and a list of fixes, runs the exact
// production path (outline -> Claude authors edits -> apply to the real page ->
// re-shoot), and returns the image plus the per-edit report.
//
// It exists because the interesting failures are not in the rendering (photos
// cannot be damaged on this path) but in the AUTHORING: whether the model picks
// selectors that resolve on an unfamiliar theme. This makes that measurable on
// any store without touching a client's audit.
//
// Service-role only; stores under bakeoff/ (never a canonical after_* path).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "audit-assets";

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !isServiceRoleAuthorization(token)) return new Response("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    url?: string;
    viewport?: string;
    label?: string;
    recommendations?: string[];
    case?: string;
    cartAdd?: { variantId?: string | null; productUrl?: string | null };
  };
  const url = String(body.url ?? "").trim();
  const recommendations = (Array.isArray(body.recommendations) ? body.recommendations : [])
    .map((r) => String(r).trim())
    .filter(Boolean);
  if (!url || recommendations.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "url and recommendations are required" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const viewport: Viewport = body.viewport === "desktop" ? "desktop" : "mobile";
  const startedAt = Date.now();

  const run = await runHtmlAfter({
    pageUrl: url,
    pageLabel: String(body.label ?? "page"),
    viewport,
    recommendations,
    cartAdd: body.cartAdd,
    timeoutMs: body.cartAdd ? 150_000 : undefined,
    secondFold: true,
  });

  const elapsedMs = Date.now() - startedAt;
  if (!run.ok) {
    return new Response(
      JSON.stringify({ ok: false, stage: run.stage, error: run.error, ops: run.ops ?? null, report: run.report ?? null, elapsedMs }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const slug = String(body.case ?? "case").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "case";
  const path = `bakeoff/html-after/${slug}_${viewport}.png`;
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, run.png, { contentType: "image/png", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ ok: false, error: `upload: ${upErr.message}`, elapsedMs }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  let url2: string | null = null;
  if (run.png2) {
    const path2 = path.replace(".png", "_fold2.png");
    const { error: up2 } = await sb.storage
      .from(BUCKET)
      .upload(path2, run.png2, { contentType: "image/png", upsert: true });
    if (!up2) url2 = `${sb.storage.from(BUCKET).getPublicUrl(path2).data?.publicUrl ?? ""}?v=${Date.now()}`;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      url: `${pub?.publicUrl ?? ""}?v=${Date.now()}`,
      url2,
      captures: run.captures,
      elapsedMs,
      unapplied: run.unapplied,
      ops: run.ops,
      report: run.report,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
