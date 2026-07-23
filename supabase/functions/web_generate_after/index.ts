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

function buildEditPrompt(label: string, recommendations: string[], hasReference: boolean, viewport: Viewport): string {
  const fixes = recommendations
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  const deviceRules = viewport === "mobile"
    ? `This is the MOBILE view. Follow native mobile UX conventions strictly: keep the primary navigation collapsed inside the hamburger menu, NEVER expand it into a horizontal row or list of text links. Stack content vertically in a single column. Make every tap target large and well spaced (at least 44x44px). Keep the key content and one call-to-action within thumb reach. Never shrink, crowd, or create tiny clickable elements.`
    : `This is the DESKTOP view. Use standard desktop conventions: a horizontal top navigation and multi-column layouts are fine.`;

  const common = [
    `Design rules:`,
    `- ${deviceRules}`,
    `- Use EXACTLY ONE primary call-to-action in the hero. Never create duplicate or competing CTA buttons (e.g. do not show both "Shop Now" and "Shop the Bundle").`,
    `- Keep all existing real text and numbers from the source (headlines, prices, phone numbers, product names) unless a fix changes them.`,
    `- If a fix calls for a new element such as a badge, star rating, or trust signal, DEPICT it as a real graphic (actual stars, an actual badge). NEVER write the element's name or a description as literal text on the page (no "Bestseller Badge", "hero image", "CTA button", "trust badge" text).`,
    `- Keep all text crisp, correctly spelled, and legible. Do not add annotations, numbered markers, callouts, arrows, borders, captions, or watermarks, and never render any of these instructions into the image.`,
    `- Output only the clean redesigned screenshot, as if it were a real live page.`,
  ].join("\n");

  if (hasReference) {
    // Mirror mode: image 1 is the current screenshot for THIS viewport, image 2
    // is the already-approved redesign for the OTHER viewport. Match the CONTENT
    // decisions but rebuild the STRUCTURE natively for this device.
    return [
      `The FIRST image is a real screenshot of the ${label} of an e-commerce store.`,
      `The SECOND image is the approved "after" redesign of the SAME page on the OTHER device.`,
      `Match the SECOND image's CONTENT and messaging decisions: the same new headline and body copy, the same offer, and the same primary call-to-action wording. But rebuild the STRUCTURE natively for THIS device using the rules below. Do NOT copy the other device's navigation style, column count, or layout (in particular, never turn a mobile menu into a desktop-style horizontal nav).`,
      `Keep the brand's real logo, product photos, color palette, and typography intact so it clearly reads as the same store.`,
      common,
    ].join("\n\n");
  }

  return [
    `This image is a real screenshot of the ${label} of an e-commerce store.`,
    `Produce an improved "after" redesign of THIS EXACT page as a realistic screenshot of the same website.`,
    `Keep the brand's real logo, product photos, color palette, and typography intact so it clearly reads as the same store. Keep the same overall page structure and aspect ratio; change only what the fixes below require.`,
    `Apply these specific conversion and UX fixes:`,
    fixes || "Improve visual hierarchy, clarity of the primary call to action, and overall polish.",
    common,
  ].join("\n\n");
}

// Calls Gemini image editing: source screenshot in, edited screenshot out. When a
// reference image is supplied (the sibling viewport's approved "after"), it is
// sent as a second image so the model mirrors the same changes across viewports.
async function geminiEditImage(
  sourcePng: Uint8Array,
  prompt: string,
  apiKey: string,
  referencePng?: Uint8Array,
): Promise<Uint8Array> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const requestParts: Array<Record<string, unknown>> = [
    { inlineData: { mimeType: "image/png", data: bytesToBase64(sourcePng) } },
  ];
  if (referencePng) requestParts.push({ inlineData: { mimeType: "image/png", data: bytesToBase64(referencePng) } });
  requestParts.push({ text: prompt });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: requestParts }],
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

type ViewportSource = { viewport: Viewport; url: string; cartCount: number };

// One source screenshot per viewport for a page (above-the-fold variant preferred).
async function listViewportSources(sb: SupabaseClient, auditId: string, pageType: string): Promise<ViewportSource[]> {
  const { data } = await sb
    .from("web_page_snapshots")
    .select("viewport, variant, status, screenshot_url, raw")
    .eq("audit_id", auditId)
    .eq("page_type", pageType)
    .eq("status", "success")
    .not("screenshot_url", "is", null);
  const rows = (data ?? []) as Array<{ viewport: string; variant: string | null; screenshot_url: string; raw: Record<string, unknown> | null }>;
  const out: ViewportSource[] = [];
  for (const vp of ["desktop", "mobile"] as Viewport[]) {
    const vpRows = rows.filter((r) => r.viewport === vp);
    if (vpRows.length === 0) continue;
    const chosen = vpRows.find((r) => r.variant === "viewport") ?? vpRows[0];
    const cartCount = Math.max(...vpRows.map((r) => Number(r.raw?.cart_count ?? -1)), -1);
    out.push({ viewport: vp, url: chosen.screenshot_url, cartCount });
  }
  return out;
}

// Which viewports to generate for a page, in order [primary, ...rest]. The
// primary is the source of truth the other viewport mirrors. Desktop is primary
// when available; for the cart, only viewports whose slide-cart actually filled
// are eligible (an "after" of an empty cart is pointless), with the filled one
// as primary.
function orderedViewports(sources: ViewportSource[], pageType: string, preferred?: Viewport): Viewport[] {
  let eligible = sources;
  if (pageType === "cart") {
    const filled = sources.filter((s) => s.cartCount > 0);
    if (filled.length > 0) eligible = filled;
  }
  const vps = eligible.map((s) => s.viewport);
  if (vps.length === 0) return [];
  let primary: Viewport | undefined = preferred && vps.includes(preferred) ? preferred : undefined;
  if (!primary) primary = vps.includes("desktop") ? "desktop" : vps[0];
  return [primary, ...vps.filter((v) => v !== primary)];
}

function recommendationsFor(section: { section_details: Record<string, unknown> | null }): string[] {
  const web = asRecord(asRecord(section.section_details).web);
  const findings = Array.isArray(web.findings) ? web.findings : [];
  return findings
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
}

// Generates + stores the "after" for one specific (section, viewport). When
// referenceAfterUrl is set (the sibling viewport's approved after), the model
// mirrors those same changes so the concepts stay consistent across devices.
async function generateOne(
  sb: SupabaseClient,
  auditId: string,
  clientId: string,
  section: { id: string; section_key: string; section_details: Record<string, unknown> | null },
  apiKey: string,
  viewport: Viewport,
  sourceUrl: string,
  referenceAfterUrl?: string,
): Promise<{ url: string; viewport: Viewport }> {
  const meta = PAGE_SECTIONS.find((s) => s.key === section.section_key);
  if (!meta) throw new Error(`section ${section.section_key} is not a page section`);

  const srcRes = await fetch(sourceUrl);
  if (!srcRes.ok) throw new Error(`fetch_source_${srcRes.status}`);
  const srcPng = new Uint8Array(await srcRes.arrayBuffer());

  let refPng: Uint8Array | undefined;
  if (referenceAfterUrl) {
    try {
      const r = await fetch(referenceAfterUrl);
      if (r.ok) refPng = new Uint8Array(await r.arrayBuffer());
    } catch {
      // best effort: fall back to a standalone (non-mirrored) generation
    }
  }

  const prompt = buildEditPrompt(meta.label, recommendationsFor(section), Boolean(refPng), viewport);
  const edited = await geminiEditImage(srcPng, prompt, apiKey, refPng);

  const path = `${clientId}/${auditId}/web/after_${meta.page_type}_${viewport}.png`;
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
  afterImages[viewport] = { url: bustedUrl, generated_at: new Date().toISOString() };
  webOut.after_images = afterImages;
  details.web = webOut;
  await sb.from("audit_sections").update({ section_details: details }).eq("id", section.id);
  section.section_details = details; // keep in-memory row fresh for the same invocation

  return { url: bustedUrl, viewport };
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

    const afterUrlFor = (
      section: { section_details: Record<string, unknown> | null },
      vp: Viewport,
    ): string | undefined => {
      const entry = asRecord(asRecord(asRecord(section.section_details).web).after_images)[vp];
      const url = asRecord(entry).url;
      return typeof url === "string" && url.length > 0 ? url : undefined;
    };

    // Single-section (on-demand button / explicit regenerate). Generates the
    // requested viewport; a non-primary viewport mirrors the primary's after.
    if (body.section_key) {
      const section = sections.find((s) => s.section_key === body.section_key);
      if (!section) return json({ ok: false, error: { code: "not_found", message: "Section not found" }, correlationId }, { status: 404 });
      const meta = PAGE_SECTIONS.find((s) => s.key === section.section_key);
      if (!meta) return json({ ok: false, error: { code: "bad_request", message: "Not a page section" }, correlationId }, { status: 400 });
      const sources = await listViewportSources(sb, auditId, meta.page_type);
      if (sources.length === 0) return json({ ok: false, error: { code: "no_screenshot", message: "No screenshot available for this page yet." }, correlationId }, { status: 200 });
      const order = orderedViewports(sources, meta.page_type, preferredViewport);
      const primaryVp = order[0];
      const targetVp: Viewport =
        preferredViewport && sources.some((s) => s.viewport === preferredViewport) ? preferredViewport : primaryVp;
      const src = sources.find((s) => s.viewport === targetVp);
      if (!src) return json({ ok: false, error: { code: "no_screenshot", message: "No screenshot for that viewport yet." }, correlationId }, { status: 200 });
      const referenceAfterUrl = targetVp !== primaryVp ? afterUrlFor(section, primaryVp) : undefined;
      const result = await generateOne(sb, auditId, clientId, section, apiKey, targetVp, src.url, referenceAfterUrl);
      return json({ ok: true, correlationId, url: result.url, viewport: result.viewport });
    }

    // Auto: build ordered (section, viewport) units (desktop/primary first so
    // mobile can mirror it), generate the next one missing an after, then
    // self-chain. One image per invocation stays under the edge wall-clock limit.
    if (mode === "auto") {
      type Unit = {
        section: { id: string; section_key: string; section_details: Record<string, unknown> | null };
        viewport: Viewport;
        url: string;
        primaryViewport: Viewport;
      };
      const units: Unit[] = [];
      for (const meta of PAGE_SECTIONS) {
        const section = sections.find((s) => s.section_key === meta.key);
        if (!section) continue;
        const sources = await listViewportSources(sb, auditId, meta.page_type);
        const order = orderedViewports(sources, meta.page_type);
        for (const vp of order) {
          const src = sources.find((s) => s.viewport === vp);
          if (src) units.push({ section, viewport: vp, url: src.url, primaryViewport: order[0] });
        }
      }
      // A unit is "done" once it has an after url OR a recorded error (so a
      // persistent failure can't loop the chain forever).
      const isDone = (u: Unit) => {
        const entry = asRecord(asRecord(asRecord(u.section.section_details).web).after_images)[u.viewport];
        const e = asRecord(entry);
        return (typeof e.url === "string" && e.url.length > 0) || e.error != null;
      };
      const next = units.find((u) => !isDone(u));
      if (!next) return json({ ok: true, correlationId, status: "complete" });

      const referenceAfterUrl =
        next.viewport !== next.primaryViewport ? afterUrlFor(next.section, next.primaryViewport) : undefined;
      try {
        await generateOne(sb, auditId, clientId, next.section, apiKey, next.viewport, next.url, referenceAfterUrl);
      } catch (e) {
        // Record the error on this viewport so the chain advances instead of
        // retrying the same unit forever.
        const details = asRecord(next.section.section_details);
        const webOut = asRecord(details.web);
        const afterImages = asRecord(webOut.after_images);
        afterImages[next.viewport] = { url: null, error: String(e instanceof Error ? e.message : e).slice(0, 200), generated_at: new Date().toISOString() };
        webOut.after_images = afterImages;
        details.web = webOut;
        await sb.from("audit_sections").update({ section_details: details }).eq("id", next.section.id);
        next.section.section_details = details;
      }
      const remaining = units.some((u) => !isDone(u));
      if (remaining) await chainAuto(auditId);
      return json({ ok: true, correlationId, status: remaining ? "in_progress" : "complete", section: next.section.section_key, viewport: next.viewport });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Provide section_key or mode:auto" }, correlationId }, { status: 400 });
  } catch (e) {
    return json({ ok: false, error: { code: "generate_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 500 });
  }
});
