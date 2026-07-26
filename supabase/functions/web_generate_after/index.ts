import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";
import { layoutGuidance, type WebPageKind } from "../_shared/ecommerce-ux-kb.ts";
import { createLlmClient, type LlmMessage, type LlmTool } from "../_shared/llm-adapter.ts";

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
// Vision model that grades the generated "after" against the fixes it should show.
const VERIFY_MODEL = "claude-sonnet-5";
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

/** Read a PNG's pixel dimensions straight out of the IHDR chunk (width and
 * height are big-endian uint32 at byte offsets 16 and 20). Lets us check the
 * generated image's SHAPE deterministically instead of trusting the model to
 * honour "keep the same aspect ratio". */
function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 24) return null;
  // PNG signature
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const read32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const w = read32(16);
  const h = read32(20);
  if (!w || !h) return null;
  return { w, h };
}

/** Is the generated image the wrong SHAPE for the device? A phone screenshot is
 * portrait and a desktop one is landscape; the image model sometimes returns a
 * wide desktop-looking layout for a mobile source, which is unusable. */
function wrongShape(source: Uint8Array, generated: Uint8Array): boolean {
  const a = pngSize(source);
  const b = pngSize(generated);
  if (!a || !b) return false; // can't tell, don't block
  const srcRatio = a.w / a.h;
  const genRatio = b.w / b.h;
  // Orientation flip (portrait source -> landscape output, or the reverse).
  if (srcRatio < 1 && genRatio >= 1) return true;
  if (srcRatio > 1 && genRatio <= 1) return true;
  // Same orientation but a very different shape (more than ~45% off) also reads
  // as broken next to the original.
  return Math.abs(genRatio - srcRatio) / srcRatio > 0.45;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function buildEditPrompt(
  label: string,
  recommendations: string[],
  hasReference: boolean,
  viewport: Viewport,
  pageKind: WebPageKind,
  freezeFloatingWidgets = false,
  hasBelowFold = false,
): string {
  const fixes = recommendations
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  const deviceRules = viewport === "mobile"
    ? `This is the MOBILE view. Follow native mobile UX conventions strictly: keep the primary navigation collapsed inside the hamburger menu, NEVER expand it into a horizontal row or list of text links. Stack content vertically in a single column, and that includes any product grid: exactly ONE product card per row, full width, never two side by side. Make every tap target large and well spaced (at least 44x44px). Keep the key content and one call-to-action within thumb reach. Never shrink, crowd, or create tiny clickable elements.`
    : `This is the DESKTOP view. Use standard desktop conventions: a horizontal top navigation and multi-column layouts are fine.`;

  // Knowing the real next section stops the two classic failures: an empty band
  // at the bottom, and invented filler products with made-up names and prices.
  const belowFoldRule = hasBelowFold
    ? [`- The FINAL image provided is NOT part of your output. It shows the real content that continues immediately BELOW this screenshot, for reference only. Keep your output framed exactly like the FIRST image (same top, same height, same aspect ratio). If your changes free up space at the bottom, fill it by continuing with the REAL next content from that final reference image, cropped naturally as a page would be. NEVER invent placeholder products, names, or prices, and NEVER leave an empty or blank band at the bottom.`]
    : [`- If your changes free up space at the bottom, do NOT invent placeholder products, names, or prices to fill it, and do not leave a blank band: keep the existing sections and let the last one crop naturally at the bottom edge, exactly as the source screenshot does.`];

  const freezeRule = freezeFloatingWidgets
    ? [`- FLOATING ICONS ARE FROZEN: reproduce every floating widget (chat bubble, rewards or loyalty badge, back-to-top button) EXACTLY as it appears in the source, the same icon in the same corner, each appearing ONCE. Do NOT move them, do NOT resize them, and above all do NOT draw an extra copy anywhere. There must be exactly as many floating icons in your output as in the source, no more.`]
    : [];

  const common = [
    `Design rules:`,
    ...belowFoldRule,
    ...freezeRule,
    `- LAYOUT (follow these standard e-commerce patterns exactly): ${layoutGuidance(pageKind)}`,
    `- ${deviceRules}`,
    `- Use EXACTLY ONE primary call-to-action in the hero. Never create duplicate or competing CTA buttons (e.g. do not show both "Shop Now" and "Shop the Bundle").`,
    `- Keep all existing real text and numbers from the source (headlines, prices, phone numbers, product names) unless a fix changes them.`,
    `- If a fix calls for a new element such as a badge, star rating, or trust signal, DEPICT it as a real graphic (actual stars, an actual badge). NEVER write the element's name or a description as literal text on the page (no "Bestseller Badge", "hero image", "CTA button", "trust badge" text).`,
    `- READABILITY IS CRITICAL: any text placed over a photo must be easy to read. Add a dark gradient or semi-transparent scrim behind the text (or place the text on a solid color panel) so it has strong contrast. Never leave light text sitting on a busy or light photo where it is hard to read.`,
    `- Every button, pill, chip, or element must look FINISHED and real: text centered and aligned, consistent padding, no empty icon boxes, no blank slots, no missing or broken icons. If you cannot render a clean icon, use text only, do not leave an empty space where an icon would go.`,
    `- Keep all text crisp, correctly spelled, and legible. Do not add annotations, numbered markers, callouts, arrows, borders, captions, or watermarks, and never render any of these instructions into the image.`,
    `- OUTPUT FRAMING: match the source screenshot's aspect ratio, width, and vertical extent as closely as you can. Show the same span of the page from top to bottom. Do not zoom in, do not crop content away, and do not return a shorter or squarer image than the source: the result is displayed side by side with the original, so a different shape looks broken.`,
    `- Output only the clean, polished, production-quality redesigned screenshot, as if it were a real live page.`,
  ].join("\n");

  if (hasReference) {
    // Mirror mode: image 1 is the current screenshot for THIS viewport, image 2
    // is the already-approved redesign for the OTHER viewport. Match the CONTENT
    // decisions but rebuild the STRUCTURE natively for this device.
    return [
      `The FIRST image is a real screenshot of the ${label} of an e-commerce store.`,
      `The SECOND image is the approved "after" redesign of the SAME page on the OTHER device.`,
      viewport === "mobile"
        ? `MANDATORY OUTPUT SHAPE: your image must be a TALL, NARROW SINGLE-COLUMN PHONE screenshot matching the FIRST image's aspect ratio and width. The SECOND image is a wide desktop layout: do NOT copy its shape, column count, or navigation. Copying the desktop layout onto the phone is the single worst mistake you can make here.`
        : `MANDATORY OUTPUT SHAPE: your image must be a WIDE DESKTOP screenshot matching the FIRST image's aspect ratio. The SECOND image is a narrow phone layout: do NOT copy its shape or its collapsed mobile navigation.`,
      `Match the SECOND image's CONTENT and messaging decisions: the same new headline and body copy, the same offer, and the same primary call-to-action wording. But rebuild the STRUCTURE natively for THIS device using the rules below. Do NOT copy the other device's navigation style, column count, or layout (in particular, never turn a mobile menu into a desktop-style horizontal nav).`,
      `On top of matching the reference, you MUST actually apply these ${viewport}-specific fixes (make the change clearly visible, e.g. real added spacing, larger tap targets, a repositioned or added element):`,
      fixes || "Improve visual hierarchy, spacing, and clarity of the primary call to action.",
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
  belowFoldPng?: Uint8Array,
): Promise<Uint8Array> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const requestParts: Array<Record<string, unknown>> = [
    { inlineData: { mimeType: "image/png", data: bytesToBase64(sourcePng) } },
  ];
  if (referencePng) requestParts.push({ inlineData: { mimeType: "image/png", data: bytesToBase64(referencePng) } });
  // The below-the-fold context image always goes LAST so its position in the
  // prompt text ("the FINAL image shows what continues below") stays stable.
  if (belowFoldPng) requestParts.push({ inlineData: { mimeType: "image/png", data: bytesToBase64(belowFoldPng) } });
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

type ViewportSource = { viewport: Viewport; url: string; cartCount: number; fold2Url?: string | null };

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
    const f2 = chosen.raw?.fold2_url;
    out.push({
      viewport: vp,
      url: chosen.screenshot_url,
      cartCount,
      fold2Url: typeof f2 === "string" && f2.length > 0 ? f2 : null,
    });
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

// Fixes about repositioning floating widgets (chat bubble, rewards/loyalty
// badge, back-to-top). The image model cannot do this edit: instead of moving the
// widget it draws a second copy and leaves the original overlapping, which is
// worse than not attempting it. We keep these OUT of the image prompt and replace
// them with a hard "reproduce the floating icons exactly once, unchanged"
// constraint. The finding still states the fix in the report text.
const FLOATING_WIDGET_FIX_RE =
  /(chat (bubble|widget|launcher|icon|button)|loyalty badge|rewards badge|floating (badge|icon|widget|button)|back to top)/i;
const REPOSITION_RE = /\b(move|relocate|reposition|shift|tuck|stack|space|separate|collapse)\b/i;

function isFloatingWidgetRepositionFix(text: string): boolean {
  return FLOATING_WIDGET_FIX_RE.test(text) && REPOSITION_RE.test(text);
}

function recommendationsFor(
  section: { section_details: Record<string, unknown> | null },
  viewport: Viewport,
): string[] {
  const web = asRecord(asRecord(section.section_details).web);
  const findings = Array.isArray(web.findings) ? web.findings : [];
  return findings
    .filter((f) => {
      const rec = asRecord(f);
      if (rec.hidden === true) return false;
      // Only this viewport's fixes (plus shared 'both') drive its "after".
      const vp = String(rec.viewport ?? "both");
      return vp === "both" || vp === viewport;
    })
    .map((f) => {
      const rec = asRecord(f);
      return typeof rec.recommendation === "string" && rec.recommendation.trim()
        ? rec.recommendation.trim()
        : typeof rec.text === "string"
        ? rec.text.trim()
        : "";
    })
    .filter(Boolean) as string[];
}

const VERIFY_TOOL: LlmTool = {
  name: "record_after_check",
  description:
    "Report whether the redesigned screenshot actually applied every requested fix, and whether the edit introduced any visual defects.",
  input_schema: {
    type: "object",
    required: ["all_applied", "unapplied_fixes", "defects"],
    properties: {
      all_applied: {
        type: "boolean",
        description: "true ONLY if every requested fix is clearly and completely visible in the second image",
      },
      unapplied_fixes: {
        type: "array",
        items: { type: "string" },
        description:
          "One short entry per requested fix that is NOT visibly applied, naming what is still wrong. Be strict: if a fix said to fit a row onto one line and it still wraps to two, or said to add an element and it is not visible, it is NOT applied.",
      },
      defects: {
        type: "array",
        items: { type: "string" },
        description:
          "Visual defects the edit introduced: duplicated text or elements, an element left behind in its old place after a move, overlapping or colliding elements, unreadable text over a photo, empty icon slots, or misspellings. ALSO report each of these as a defect: (a) IMG_2 is in the WRONG DEVICE LAYOUT, i.e. IMG_1 is a narrow phone screenshot but IMG_2 is a wide multi-column desktop layout, or the reverse; (b) the main product photo from IMG_1 is missing, shrunk to a thumbnail, or replaced by a row of thumbnails; (c) product images changed shape, for example square cards in IMG_1 becoming taller or wider in IMG_2, or a photo cropped or stretched; (d) IMG_2 looks more crowded than IMG_1, with smaller text or tighter spacing. All of these are serious.",
      },
    },
  },
};

/** Check the generated "after" against the fixes it was supposed to apply. The
 * image model often produces a pretty screenshot that quietly skips a structural
 * change (reflowing a nav to one row) or an addition (a notify-me button), so we
 * grade the result and feed the misses back for one corrective attempt. Never
 * throws: if the check itself fails we accept the image as-is. */
async function verifyAfterImage(
  beforeUrl: string,
  afterUrl: string,
  recommendations: string[],
  viewport: Viewport,
): Promise<{ ok: boolean; feedback: string }> {
  if (recommendations.length === 0) return { ok: true, feedback: "" };
  try {
    const llm = createLlmClient("anthropic", { model: VERIFY_MODEL });
    const fixes = recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n");
    const messages: LlmMessage[] = [{
      role: "user_images",
      text:
        `IMG_1 is the ORIGINAL ${viewport} screenshot. IMG_2 is an AI redesign of it that was supposed to apply these fixes:\n\n${fixes}\n\n` +
        `Compare the two images and judge STRICTLY whether each fix is genuinely visible in IMG_2. A fix that was only partially done does not count as applied. Also report any defect the edit introduced, especially duplicated text or elements, or an element that was supposed to move but is still in its old position. Call record_after_check exactly once.`,
      images: [
        { url: beforeUrl, label: "IMG_1: original" },
        { url: afterUrl, label: "IMG_2: redesign to grade" },
      ],
    }];
    const turn = await llm.runTurn({
      system:
        "You are a meticulous design QA reviewer. You compare a redesigned screenshot against the original and the list of fixes it was meant to apply, and you report honestly and strictly what was not done. Never give the benefit of the doubt.",
      messages,
      tools: [VERIFY_TOOL],
      toolChoice: { type: "tool", name: "record_after_check" },
    });
    if (turn.kind !== "tool_call") return { ok: true, feedback: "" };
    const out = (turn.input ?? {}) as { all_applied?: unknown; unapplied_fixes?: unknown; defects?: unknown };
    const missing = Array.isArray(out.unapplied_fixes) ? out.unapplied_fixes.map(String).filter(Boolean) : [];
    const defects = Array.isArray(out.defects) ? out.defects.map(String).filter(Boolean) : [];
    if (out.all_applied === true && defects.length === 0) return { ok: true, feedback: "" };
    if (missing.length === 0 && defects.length === 0) return { ok: true, feedback: "" };
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`These required fixes were NOT applied in your previous attempt, you MUST make each one clearly visible this time:\n${missing.map((m, i) => `${i + 1}. ${m}`).join("\n")}`);
    if (defects.length > 0) parts.push(`Your previous attempt also introduced these defects, which you MUST avoid:\n${defects.map((d, i) => `${i + 1}. ${d}`).join("\n")}`);
    return { ok: false, feedback: parts.join("\n\n") };
  } catch {
    return { ok: true, feedback: "" };
  }
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
  belowFoldUrl?: string | null,
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

  // Context only: the real content just below this crop, so the redesign can
  // continue it instead of inventing filler or leaving the bottom empty.
  let belowPng: Uint8Array | undefined;
  if (belowFoldUrl) {
    try {
      const r = await fetch(belowFoldUrl);
      if (r.ok) belowPng = new Uint8Array(await r.arrayBuffer());
    } catch {
      // best effort: the prompt falls back to "do not invent filler"
    }
  }

  const allRecommendations = recommendationsFor(section, viewport);
  // Drop floating-widget repositioning fixes: the model reliably duplicates the
  // widget instead of moving it. Everything else is still applied.
  const applicable = allRecommendations.filter((r) => !isFloatingWidgetRepositionFix(r));
  const skippedWidgetFix = applicable.length !== allRecommendations.length;
  // Cap how many fixes one image tries to show. Asking for every fix at once
  // makes the model shrink type and cram blocks together, which reads as a
  // cluttered page and undercuts the very point of the concept. Findings are
  // written highest-impact first, so the top few are the ones worth depicting;
  // the rest still appear as text in the report. A phone screen holds less, so
  // its budget is tighter.
  const MAX_FIXES = viewport === "mobile" ? 4 : 5;
  const recommendations = applicable.slice(0, MAX_FIXES);
  const basePrompt = buildEditPrompt(
    meta.label,
    recommendations,
    Boolean(refPng),
    viewport,
    meta.page_type as WebPageKind,
    skippedWidgetFix,
    Boolean(belowPng),
  );

  const path = `${clientId}/${auditId}/web/after_${meta.page_type}_${viewport}.png`;
  const store = async (bytes: Uint8Array): Promise<string> => {
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);
    const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl ?? null;
    if (!publicUrl) throw new Error("no_public_url");
    // Cache-bust so a regenerate shows the new image immediately (same path).
    return `${publicUrl}?v=${Date.now()}`;
  };

  const shapeNote = viewport === "mobile"
    ? "Your previous attempt came back in the WRONG SHAPE: it was a wide desktop-style layout, but this is a PHONE screenshot. Output a tall, narrow, single-column phone image with the same aspect ratio as the source."
    : "Your previous attempt came back in the WRONG SHAPE. Output a wide desktop image with the same aspect ratio as the source.";

  let edited = await geminiEditImage(srcPng, basePrompt, apiKey, refPng, belowPng);

  // Deterministic shape gate BEFORE anything else: a mobile source that comes
  // back landscape is unusable, and no amount of prompting reliably prevents it.
  // Regenerate once without the sibling reference, which is what tempts the model
  // to copy the other device's layout in the first place.
  if (wrongShape(srcPng, edited)) {
    try {
      const reshot = await geminiEditImage(srcPng, `${basePrompt}\n\n${shapeNote}`, apiKey, undefined, belowPng);
      if (!wrongShape(srcPng, reshot)) edited = reshot;
      else {
        // Still the wrong device shape. Storing it would show a desktop layout
        // under a "mobile" toggle, so record the failure and show Before only.
        throw new Error("wrong_shape_after_retry");
      }
    } catch (e) {
      if (e instanceof Error && e.message === "wrong_shape_after_retry") throw e;
      throw new Error("wrong_shape");
    }
  }

  let bustedUrl = await store(edited);

  // Grade the result and give the model ONE corrective attempt when it skipped a
  // fix or introduced a defect. Capped at one retry to stay inside the edge
  // function's wall clock. The retry gets a strictly more specific prompt, so if
  // it succeeds we keep it; if the retry itself fails we keep the first attempt.
  const check = await verifyAfterImage(sourceUrl, bustedUrl, recommendations, viewport);
  if (!check.ok) {
    try {
      const retryPrompt = `${basePrompt}\n\nIMPORTANT, THIS IS A SECOND ATTEMPT. ${check.feedback}\n\nProduce the corrected screenshot with every fix above clearly visible and no duplicated or leftover elements.`;
      const retried = await geminiEditImage(srcPng, retryPrompt, apiKey, refPng, belowPng);
      // Never let a corrective attempt regress the device shape.
      if (!wrongShape(srcPng, retried)) bustedUrl = await store(retried);
    } catch {
      // Retry failed outright: the first attempt is already stored, keep it.
    }
  }

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
    // Afters can't run without a key; don't leave the report gated on them.
    try { await assertServiceClient().from("audits").update({ web_afters_ready: true }).eq("id", auditId); } catch { /* non-fatal */ }
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
      const result = await generateOne(sb, auditId, clientId, section, apiKey, targetVp, src.url, referenceAfterUrl, src.fold2Url);
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
        fold2Url?: string | null;
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
          if (src) units.push({ section, viewport: vp, url: src.url, fold2Url: src.fold2Url, primaryViewport: order[0] });
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
      if (!next) {
        // All after images done (success or recorded error): let the report show.
        try { await sb.from("audits").update({ web_afters_ready: true }).eq("id", auditId); } catch { /* non-fatal */ }
        return json({ ok: true, correlationId, status: "complete" });
      }

      const referenceAfterUrl =
        next.viewport !== next.primaryViewport ? afterUrlFor(next.section, next.primaryViewport) : undefined;
      try {
        await generateOne(sb, auditId, clientId, next.section, apiKey, next.viewport, next.url, referenceAfterUrl, next.fold2Url);
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
      else {
        // Last unit just finished: reveal the report.
        try { await sb.from("audits").update({ web_afters_ready: true }).eq("id", auditId); } catch { /* non-fatal */ }
      }
      return json({ ok: true, correlationId, status: remaining ? "in_progress" : "complete", section: next.section.section_key, viewport: next.viewport });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Provide section_key or mode:auto" }, correlationId }, { status: 400 });
  } catch (e) {
    return json({ ok: false, error: { code: "generate_failed", message: e instanceof Error ? e.message : "Unknown error" }, correlationId }, { status: 500 });
  }
});
