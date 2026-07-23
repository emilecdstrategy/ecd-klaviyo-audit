import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";

// Generates an "after" concept image for a web-audit page section by editing the
// real above-the-fold screenshot in place with Google's Gemini image model
// (nano-banana). Editing (not generating from scratch) keeps the brand's real
// logo, colors, fonts, and product photos intact while applying the fixes.
//
// Two modes:
//  - Single: { audit_id, section_key, viewport? } generates one image and returns
//    its URL. Used by the on-demand "Regenerate" button in the report editor.
//  - Auto:   { audit_id, mode:"auto" } finds the next page section without an
//    after image and generates one, then self-chains for the rest. Fired
//    (best effort) at the end of web_finalize_analysis.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-3.1-flash-image";
const STORAGE_BUCKET = "audit-assets";

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

function assertServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Viewport = "desktop" | "mobile";

// Page sections that get an "after" (screenshot-backed). Analytics/overview/
// roadmap have no page shot, so they are excluded.
const PAGE_SECTIONS: Array<{ key: string; page_type: string; label: string }> = [
  { key: "web_homepage", page_type: "homepage", label: "homepage" },
  { key: "web_product_page", page_type: "product", label: "product page" },
  { key: "web_collection_page", page_type: "collection", label: "collection page" },
  { key: "web_cart", page_type: "cart", label: "cart / slide-out cart drawer" },
];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function buildEditPrompt(label: string, recommendations: string[]): string {
  const fixes = recommendations
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");
  return [
    `This image is a real screenshot of the ${label} of an e-commerce store.`,
    `Produce an improved "after" redesign of THIS EXACT page as a realistic screenshot of the same website.`,
    `Keep the brand's real logo, product photos, color palette, and typography intact so it clearly reads as the same store. Keep the same overall page structure and aspect ratio; change only what the fixes below require.`,
    `Apply these specific conversion and UX fixes:`,
    fixes || "Improve visual hierarchy, clarity of the primary call to action, and overall polish.",
    `Make text crisp and legible. Do NOT invent phone numbers, prices, discounts, product names, or contact details that are not already in the original image, keep any such text the same as the source. Do NOT add any annotations, numbered markers, callouts, borders, captions, or watermarks. Output only the redesigned screenshot.`,
  ].join("\n\n");
}

// Calls Gemini image editing: source screenshot in, edited screenshot out.
async function geminiEditImage(sourcePng: Uint8Array, prompt: string, apiKey: string): Promise<Uint8Array> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: bytesToBase64(sourcePng) } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"], temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`gemini_http_${res.status}: ${detail}`);
  }
  const data = await res.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  } | null;
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = (part.inlineData ?? part.inline_data) as { data?: string; mimeType?: string } | undefined;
    if (inline?.data) return base64ToBytes(inline.data);
  }
  throw new Error("gemini_no_image_returned");
}

// Picks the source screenshot to edit for a section: prefers the requested
// viewport's above-the-fold shot, then desktop, then mobile, then any success.
async function pickSourceSnapshot(
  sb: SupabaseClient,
  auditId: string,
  pageType: string,
  preferred?: Viewport,
): Promise<{ url: string; viewport: Viewport } | null> {
  const { data } = await sb
    .from("web_page_snapshots")
    .select("viewport, variant, status, screenshot_url")
    .eq("audit_id", auditId)
    .eq("page_type", pageType)
    .eq("status", "success")
    .not("screenshot_url", "is", null);
  const rows = (data ?? []) as Array<{ viewport: string; variant: string | null; screenshot_url: string }>;
  if (rows.length === 0) return null;
  const order: Viewport[] = preferred === "mobile" ? ["mobile", "desktop"] : ["desktop", "mobile"];
  for (const vp of order) {
    const viewportShot = rows.find((r) => r.viewport === vp && r.variant === "viewport");
    if (viewportShot) return { url: viewportShot.screenshot_url, viewport: vp };
    const anyShot = rows.find((r) => r.viewport === vp);
    if (anyShot) return { url: anyShot.screenshot_url, viewport: vp };
  }
  const first = rows[0];
  return { url: first.screenshot_url, viewport: first.viewport === "mobile" ? "mobile" : "desktop" };
}

// Generates + stores one after image for a single section. Returns the public
// URL, or null if the section has no source screenshot to edit.
async function generateForSection(
  sb: SupabaseClient,
  auditId: string,
  clientId: string,
  section: { id: string; section_key: string; section_details: Record<string, unknown> | null },
  apiKey: string,
  preferredViewport?: Viewport,
): Promise<{ url: string; viewport: Viewport } | null> {
  const meta = PAGE_SECTIONS.find((s) => s.key === section.section_key);
  if (!meta) throw new Error(`section ${section.section_key} is not a page section`);

  const source = await pickSourceSnapshot(sb, auditId, meta.page_type, preferredViewport);
  if (!source) return null;

  const web = asRecord(asRecord(section.section_details).web);
  const findings = Array.isArray(web.findings) ? web.findings : [];
  const recommendations = findings
    .map((f) => {
      const rec = asRecord(f);
      if (rec.hidden === true) return "";
      return typeof rec.recommendation === "string" && rec.recommendation.trim()
        ? rec.recommendation.trim()
        : typeof rec.text === "string"
        ? rec.text.trim()
        : "";
    })
    .filter(Boolean) as string[];

  const srcRes = await fetch(source.url);
  if (!srcRes.ok) throw new Error(`fetch_source_${srcRes.status}`);
  const srcPng = new Uint8Array(await srcRes.arrayBuffer());

  const edited = await geminiEditImage(srcPng, buildEditPrompt(meta.label, recommendations), apiKey);

  const path = `${clientId}/${auditId}/web/after_${meta.page_type}_${source.viewport}.png`;
  const { error: uploadErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, edited, { contentType: "image/png", upsert: true });
  if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);
  const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl ?? null;
  if (!publicUrl) throw new Error("no_public_url");

  // Cache-bust so a regenerate shows the new image immediately (same path).
  const bustedUrl = `${publicUrl}?v=${Date.now()}`;

  const details = asRecord(section.section_details);
  const webOut = asRecord(details.web);
  const afterImages = asRecord(webOut.after_images);
  afterImages[source.viewport] = { url: bustedUrl, generated_at: new Date().toISOString() };
  webOut.after_images = afterImages;
  details.web = webOut;
  await sb.from("audit_sections").update({ section_details: details }).eq("id", section.id);

  return { url: bustedUrl, viewport: source.viewport };
}

async function chainAuto(auditId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await Promise.race([
      fetch(`${SUPABASE_URL}/functions/v1/web_generate_after`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({ audit_id: auditId, mode: "auto" }),
      }),
      new Promise((r) => setTimeout(r, 2_000)),
    ]);
  } catch {
    // best effort
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  const correlationId = crypto.randomUUID();
  let body: { audit_id?: string; section_key?: string; viewport?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: { code: "bad_request", message: "Invalid JSON" }, correlationId }, { status: 400 });
  }
  const auditId = (body.audit_id ?? "").trim();
  if (!auditId) return json({ ok: false, error: { code: "bad_request", message: "Missing audit_id" }, correlationId }, { status: 400 });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const isService = isServiceRoleAuthorization(token);
  if (!isService) {
    try {
      await getUserIdFromAuthorization(req);
    } catch (e) {
      return json({ ok: false, error: { code: "unauthorized", message: e instanceof Error ? e.message : "Unauthorized" }, correlationId }, { status: 401 });
    }
  }

  // Key is managed in admin Settings (app_secrets 'gemini_api_key'); getSecret
  // also honors a GEMINI_API_KEY env override for local testing.
  let apiKey = "";
  try {
    apiKey = (await getSecret("gemini_api_key")).trim();
  } catch {
    apiKey = "";
  }
  if (!apiKey) {
    return json({ ok: false, error: { code: "not_configured", message: "Image generation is not configured. Add a Gemini API key in Settings." }, correlationId }, { status: 200 });
  }

  try {
    const sb = assertServiceClient();
    const { data: audit } = await sb.from("audits").select("id, client_id, audit_type").eq("id", auditId).maybeSingle();
    if (!audit) return json({ ok: false, error: { code: "not_found" }, correlationId }, { status: 404 });
    if (audit.audit_type !== "web") return json({ ok: true, correlationId, status: "skipped", reason: "not_web_audit" });
    const clientId = audit.client_id as string;

    const { data: sectionRows } = await sb
      .from("audit_sections")
      .select("id, section_key, section_details")
      .eq("audit_id", auditId)
      .in("section_key", PAGE_SECTIONS.map((s) => s.key));
    const sections = (sectionRows ?? []) as Array<{ id: string; section_key: string; section_details: Record<string, unknown> | null }>;

    const mode = (body.mode ?? "").trim();
    const preferredViewport: Viewport | undefined = body.viewport === "mobile" ? "mobile" : body.viewport === "desktop" ? "desktop" : undefined;

    // Single-section (on-demand button / explicit regenerate).
    if (body.section_key) {
      const section = sections.find((s) => s.section_key === body.section_key);
      if (!section) return json({ ok: false, error: { code: "not_found", message: "Section not found" }, correlationId }, { status: 404 });
      const result = await generateForSection(sb, auditId, clientId, section, apiKey, preferredViewport);
      if (!result) return json({ ok: false, error: { code: "no_screenshot", message: "No screenshot available for this page yet." }, correlationId }, { status: 200 });
      return json({ ok: true, correlationId, url: result.url, viewport: result.viewport });
    }

    // Auto: generate for the next section that has a screenshot but no after
    // image yet, then self-chain for the remainder. One image per invocation
    // keeps each call well under the edge runtime wall-clock limit.
    if (mode === "auto") {
      const pending = sections.filter((s) => {
        const after = asRecord(asRecord(asRecord(s.section_details).web).after_images);
        return Object.keys(after).length === 0;
      });
      if (pending.length === 0) return json({ ok: true, correlationId, status: "complete" });
      const section = pending[0];
      try {
        await generateForSection(sb, auditId, clientId, section, apiKey);
      } catch (e) {
        // Don't let one section's failure stall the rest; mark it attempted so
        // the chain moves on instead of retrying the same section forever.
        const details = asRecord(section.section_details);
        const webOut = asRecord(details.web);
        const afterImages = asRecord(webOut.after_images);
        afterImages.error = String(e instanceof Error ? e.message : e).slice(0, 200);
        webOut.after_images = afterImages;
        details.web = webOut;
        await sb.from("audit_sections").update({ section_details: details }).eq("id", section.id);
      }
      if (pending.length > 1) await chainAuto(auditId);
      return json({ ok: true, correlationId, status: pending.length > 1 ? "in_progress" : "complete", section: section.section_key });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Provide section_key or mode:auto" }, correlationId }, { status: 400 });
  } catch (e) {
    return json({ ok: false, error: { code: "generate_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 500 });
  }
});
