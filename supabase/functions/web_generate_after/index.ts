import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getUserIdFromAuthorization, isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";
import { type WebPageKind } from "../_shared/ecommerce-ux-kb.ts";
// The prompt, the Gemini call, and the vision QA live in _shared so the model
// bake-off script exercises candidate models with the EXACT production pieces.
import {
  buildEditPrompt,
  geminiEditImage,
  photoShapeNote,
  pngSize,
  wrongShape,
  type CapturedEl,
  type Viewport,
} from "../_shared/after-image-prompt.ts";
import {
  isPhotoDefect,
  verifyAfterImage,
  verifyPhotoFidelity,
  verifyScore,
} from "../_shared/after-image-verify.ts";
import { autoPublishAudit } from "../_shared/auto-publish.ts";

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

type ViewportSource = {
  viewport: Viewport;
  url: string;
  cartCount: number;
  fold2Url?: string | null;
  elements?: CapturedEl[];
};

// One source screenshot per viewport for a page (above-the-fold variant preferred).
async function listViewportSources(sb: SupabaseClient, auditId: string, pageType: string): Promise<ViewportSource[]> {
  const { data } = await sb
    .from("web_page_snapshots")
    .select("viewport, variant, status, screenshot_url, raw, elements")
    .eq("audit_id", auditId)
    .eq("page_type", pageType)
    .eq("status", "success")
    .not("screenshot_url", "is", null);
  const rows = (data ?? []) as Array<{
    viewport: string;
    variant: string | null;
    screenshot_url: string;
    raw: Record<string, unknown> | null;
    elements: CapturedEl[] | null;
  }>;
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
      elements: Array.isArray(chosen.elements) ? chosen.elements : [],
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
  sourceElements?: CapturedEl[],
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
  // Raised from 4/5: anything past the cap is never sent to the model, so a
  // page with six findings silently lost the tail every time. The cap exists
  // only to stop one prompt asking for so much that the model starts reflowing
  // the page (which is how photos got rescaled), so it is generous, not tight.
  const MAX_FIXES = viewport === "mobile" ? 6 : 7;
  const recommendations = applicable.slice(0, MAX_FIXES);
  // Everything past the cap is never sent to the model, so it can never appear.
  // Record it rather than letting the counts imply it was done.
  const notAttempted = applicable.slice(MAX_FIXES);
  if (notAttempted.length > 0) {
    console.log(
      `after-image ${meta.label}/${viewport}: ${notAttempted.length} fix(es) over the ${MAX_FIXES} cap were not attempted`,
    );
  }
  const basePrompt = buildEditPrompt(
    meta.label,
    recommendations,
    Boolean(refPng),
    viewport,
    meta.page_type as WebPageKind,
    skippedWidgetFix,
    Boolean(belowPng),
    photoShapeNote(sourceElements, pngSize(srcPng)),
  );

  const path = `${clientId}/${auditId}/web/after_${meta.page_type}_${viewport}.png`;
  // Retries are judged at a scratch path and only promoted if they win, so a
  // rejected retry is never, even briefly, the live image at the canonical URL.
  const candidatePath = `${clientId}/${auditId}/web/after_${meta.page_type}_${viewport}_candidate.png`;
  const storeAt = async (objectPath: string, bytes: Uint8Array): Promise<string> => {
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, bytes, { contentType: "image/png", upsert: true });
    if (uploadErr) throw new Error(`upload_failed: ${uploadErr.message}`);
    const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl ?? null;
    if (!publicUrl) throw new Error("no_public_url");
    // Cache-bust so a regenerate shows the new image immediately (same path).
    return `${publicUrl}?v=${Date.now()}`;
  };
  const store = (bytes: Uint8Array) => storeAt(path, bytes);

  const shapeNote = viewport === "mobile"
    ? "Your previous attempt came back in the WRONG SHAPE: it was a wide desktop-style layout, but this is a PHONE screenshot. Output a tall, narrow, single-column phone image with the same aspect ratio as the source."
    : "Your previous attempt came back in the WRONG SHAPE. Output a wide desktop image with the same aspect ratio as the source.";

  // Gemini intermittently answers with text and no image for the same input:
  // two identical calls on the Power Planter product page gave one image and one
  // gemini_no_image_returned. Left alone that was a coin flip which either 500'd
  // the whole generation or, inside the corrective retry, silently cancelled it.
  // Same prompt, one more go, before treating it as a real failure.
  const gemini = async (prompt: string, referencePng?: Uint8Array) => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const candidates = await geminiEditImage(srcPng, prompt, apiKey, {
          model: GEMINI_IMAGE_MODEL,
          referencePng,
          belowFoldPng: belowPng,
        });
        if (candidates[0]) return candidates[0];
        lastErr = new Error("gemini_no_image_returned");
      } catch (e) {
        lastErr = e;
        // A timeout or a refusal will not fix itself on an immediate retry.
        const msg = e instanceof Error ? e.message : String(e);
        if (/timeout|abort|safety|blocked|api_key|quota/i.test(msg)) throw e;
      }
      console.warn(`after-image: gemini attempt ${attempt} produced no image, retrying`);
    }
    throw lastErr instanceof Error ? lastErr : new Error("gemini_no_image_returned");
  };

  const startedAt = Date.now();
  let edited = await gemini(basePrompt, refPng);

  // Deterministic shape gate BEFORE anything else: a mobile source that comes
  // back landscape is unusable, and no amount of prompting reliably prevents it.
  // Regenerate once without the sibling reference, which is what tempts the model
  // to copy the other device's layout in the first place.
  if (wrongShape(srcPng, edited)) {
    try {
      const reshot = await gemini(`${basePrompt}\n\n${shapeNote}`, undefined);
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
  const check = await gradeWithPhotoCheck(sourceUrl, bustedUrl, recommendations, viewport);
  // Persisted with the image so a bad result can be diagnosed from the DB:
  // did the judge miss the problem, or see it and ship the lesser evil anyway?
  const verify: Record<string, unknown> = {
    attempt1: { missing: check.missing, defects: check.defects },
    retry_ran: false,
    published: "attempt1",
  };
  // The bytes and verdict of whatever is currently published, for the polish pass.
  let finalBytes = edited;
  let finalVerdict = check;
  if (!check.ok) {
    try {
      const photoTrouble = check.defects.some(isPhotoDefect);
      // The retry never repeats the first prompt verbatim: same prompt, same
      // model, same temperature just reproduces the first failure.
      // - Photo trouble: mangled photos are a symptom of asking for too much at
      //   once, so ask for LESS (top two fixes) and re-anchor on the photos.
      // - Missing fixes only: re-ask for ONLY what was missed, framed as small
      //   surgical edits to an otherwise-final page. The full-list retry kept
      //   skipping the same small additions (a star rating line) it skipped the
      //   first time.
      const focusedOnMissing = !photoTrouble && check.missing.length > 0;
      const retryFixes = photoTrouble
        ? recommendations.slice(0, 2)
        : focusedOnMissing
          ? check.missing
          : recommendations;
      const retryBase = photoTrouble || focusedOnMissing
        ? buildEditPrompt(
          meta.label,
          retryFixes,
          !photoTrouble && Boolean(refPng),
          viewport,
          meta.page_type as WebPageKind,
          skippedWidgetFix,
          Boolean(belowPng),
          photoShapeNote(sourceElements, pngSize(srcPng)),
        )
        : basePrompt;
      const lead = photoTrouble
        ? `IMPORTANT, THIS IS A SECOND ATTEMPT AND YOUR LAST ONE DAMAGED THE IMAGERY. ${check.feedback}\n\nThis time, treat every photograph as untouchable: copy each one across at the same shape, the same framing, and the same size as the original. Apply only the small number of fixes listed above, and if a fix cannot be done without rescaling or re-cropping a photo, leave that fix out entirely and keep the photo intact.`
        : focusedOnMissing
          ? `IMPORTANT, THIS IS A SECOND ATTEMPT. Your previous attempt was good EXCEPT that the small number of fixes listed above were not visible in it. Treat the page as already final: make ONLY those additions or changes, clearly visible, and change NOTHING else anywhere on the page.`
          : `IMPORTANT, THIS IS A SECOND ATTEMPT. ${check.feedback}\n\nProduce the corrected screenshot with every fix above clearly visible and no duplicated or leftover elements.`;
      const retried = await gemini(
        `${retryBase}\n\n${lead}`,
        // The sibling reference tempts the model to re-lay-out the page, which is
        // how photos get rescaled. Drop it when photos are the problem.
        photoTrouble ? undefined : refPng,
      );
      // Never let a corrective attempt regress the device shape.
      if (!wrongShape(srcPng, retried)) {
        // Judge the retry at the scratch path; the canonical image is untouched
        // until the retry has actually won.
        const candidateUrl = await storeAt(candidatePath, retried);
        // Grade the retry too. It used to be accepted blind, so a second attempt
        // that still cropped the photos shipped anyway, sometimes worse than the
        // first.
        // Grade the retry against the FULL fix list, not just what it was asked
        // to do. A fewer-fixes retry that silently drops fixes the first attempt
        // had must lose points for them, or "asked for less" wins for free.
        const recheck = await gradeWithPhotoCheck(sourceUrl, candidateUrl, recommendations, viewport);
        verify.retry_ran = true;
        verify.retry_mode = photoTrouble ? "fewer_fixes" : focusedOnMissing ? "missing_only" : "full";
        verify.retry = { missing: recheck.missing, defects: recheck.defects };
        // When photos were the problem, the retry has to actually fix the photos
        // to win. Comparing total scores would let it win just for having been
        // asked to apply fewer fixes, which lowers the "missing" count for free.
        const photoBefore = check.defects.filter(isPhotoDefect).length;
        const photoAfter = recheck.defects.filter(isPhotoDefect).length;
        // In photo mode the retry must actually heal the photos AND not lose
        // more elsewhere (both verdicts are graded against the full fix list,
        // so dropped fixes now count against it).
        const accept = photoTrouble
          ? photoAfter < photoBefore && verifyScore(recheck) <= verifyScore(check)
          : verifyScore(recheck) <= verifyScore(check);
        if (accept) {
          bustedUrl = await store(retried);
          verify.published = "retry";
          finalBytes = retried;
          finalVerdict = recheck;
        }
        // Scratch object is transient either way; ignore cleanup failures.
        await sb.storage.from(STORAGE_BUCKET).remove([candidatePath]).catch(() => {});
      }
    } catch (e) {
      // Retry failed outright: the first attempt is already stored, keep it.
      // Record WHY, because a bare catch here made "the verifier caught the
      // crop but nothing was retried" impossible to diagnose from the row.
      verify.retry_error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
  }

  // Final polish. Whatever won can still be missing small fixes, because
  // fewer-fixes mode sacrifices the tail of the list by design; the star-rating
  // line lost this way three times in a row on one store. Editing the
  // near-final AFTER itself ("the page is final, add only this, change nothing
  // else") is the most reliable operation the image model does, so spend one
  // more generation when something is missing and the wall clock allows it.
  const dupWidget = finalVerdict.defects.some(
    (d) => /duplicat/i.test(d) && /widget|bubble|badge|icon/i.test(d),
  );
  if ((finalVerdict.missing.length > 0 || dupWidget) && Date.now() - startedAt < 90_000) {
    try {
      const polishFixes = [
        ...finalVerdict.missing,
        ...(dupWidget
          ? [
            "Remove the duplicated floating widgets: each floating element (chat bubble, loyalty or rewards badge, back-to-top button) must appear exactly ONCE, in one corner.",
          ]
          : []),
      ];
      const polishPrompt = [
        `This image is a nearly finished redesign of the ${meta.label} of an e-commerce store. Treat it as FINAL.`,
        `Make ONLY these small corrections, each clearly visible, and change NOTHING else anywhere on the page:`,
        polishFixes.map((r, i) => `${i + 1}. ${r}`).join("\n"),
        `Keep every photograph, heading, button, and layout region exactly as it is. Do not re-lay-out anything. Output the full corrected screenshot at the same size and aspect ratio.`,
      ].join("\n\n");
      const polished = (await geminiEditImage(finalBytes, polishPrompt, apiKey, { model: GEMINI_IMAGE_MODEL }))[0];
      if (!wrongShape(srcPng, polished)) {
        const polishUrl = await storeAt(candidatePath, polished);
        const pcheck = await gradeWithPhotoCheck(sourceUrl, polishUrl, recommendations, viewport);
        verify.polish_ran = true;
        verify.polish = { missing: pcheck.missing, defects: pcheck.defects };
        // Promote only a strict improvement: photos no worse, total score lower.
        const photosNotWorse =
          pcheck.defects.filter(isPhotoDefect).length <= finalVerdict.defects.filter(isPhotoDefect).length;
        if (photosNotWorse && verifyScore(pcheck) < verifyScore(finalVerdict)) {
          bustedUrl = await store(polished);
          verify.published = "polish";
        }
        await sb.storage.from(STORAGE_BUCKET).remove([candidatePath]).catch(() => {});
      }
    } catch {
      // Best effort: the published image is already the best of the earlier attempts.
    }
  }

  // What the judge still could not see in the image we are publishing. Some
  // recommendations are structural (moving a bar into a menu) and the model will
  // not do them however precisely it is asked, so after every pass has run this
  // gets recorded rather than quietly published as if it were applied.
  const publishedVariant = String(verify.published ?? "attempt1");
  const publishedVerdict = asRecord(verify[publishedVariant]);
  const graded = Array.isArray(publishedVerdict.missing) ? (publishedVerdict.missing as string[]) : [];
  // A capped fix is unapplied too, and more definitely so than one the judge
  // merely could not see.
  const unapplied = [...graded, ...notAttempted.map((r) => `Not attempted (over the ${MAX_FIXES}-fix limit for this image): ${r}`)];

  const details = asRecord(section.section_details);
  const webOut = asRecord(details.web);
  const afterImages = asRecord(webOut.after_images);
  afterImages[viewport] = {
    url: bustedUrl,
    generated_at: new Date().toISOString(),
    verify,
    unapplied,
    applied_count: Math.max(0, recommendations.length - graded.length),
    // Count every applicable fix, not just the ones that fitted the cap, so the
    // ratio matches what the report shows the client.
    total_count: applicable.length,
  };
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

/** Grade a candidate AND run the dedicated photo-geometry pass, merging the two.
 * Cropping kept surviving the combined rubric, so it gets its own question. */
async function gradeWithPhotoCheck(
  sourceUrl: string,
  candidateUrl: string,
  recommendations: string[],
  viewport: Viewport,
) {
  const [graded, alteredPhotos] = await Promise.all([
    verifyAfterImage(sourceUrl, candidateUrl, recommendations, viewport),
    verifyPhotoFidelity(sourceUrl, candidateUrl),
  ]);
  if (alteredPhotos.length === 0) return graded;
  const extra = alteredPhotos.map((p) => `Photo geometry changed: ${p}`);
  const defects = [...graded.defects, ...extra];
  return {
    ok: false,
    defects,
    missing: graded.missing,
    feedback: [
      graded.feedback,
      "Your previous attempt CHANGED THE SHAPE OR CROP of photos, which is never acceptable:\n" +
      extra.map((d, i) => `${i + 1}. ${d}`).join("\n") +
      "\nReproduce every photo with the exact framing, crop and proportions it has in the original. " +
      "Take any space you need from padding or headings, never from inside a photo.",
    ].filter(Boolean).join("\n\n"),
  };
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
    await autoPublishAudit(assertServiceClient(), auditId);
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
      const result = await generateOne(sb, auditId, clientId, section, apiKey, targetVp, src.url, referenceAfterUrl, src.fold2Url, src.elements);
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
        elements?: CapturedEl[];
      };
      const units: Unit[] = [];
      for (const meta of PAGE_SECTIONS) {
        const section = sections.find((s) => s.section_key === meta.key);
        if (!section) continue;
        const sources = await listViewportSources(sb, auditId, meta.page_type);
        const order = orderedViewports(sources, meta.page_type);
        for (const vp of order) {
          const src = sources.find((s) => s.viewport === vp);
          if (src) units.push({ section, viewport: vp, url: src.url, fold2Url: src.fold2Url, primaryViewport: order[0], elements: src.elements });
        }
      }
      // A unit is "done" once it has an after url OR a recorded error (so a
      // persistent failure can't loop the chain forever).
      const isDone = (u: Unit) => {
        const entry = asRecord(asRecord(asRecord(u.section.section_details).web).after_images)[u.viewport];
        const e = asRecord(entry);
        return (typeof e.url === "string" && e.url.length > 0) || e.error != null;
      };
      // Gemini sometimes returns no image at all for one call. That is transient,
      // but recording it as a terminal error left a page with no after image and
      // nothing to retry it. Give a unit MAX_UNIT_ATTEMPTS goes before the error
      // becomes terminal; the attempt counter lives on the entry so it survives
      // the self-chaining hops.
      const MAX_UNIT_ATTEMPTS = 3;
      const attemptsFor = (u: Unit) => {
        const entry = asRecord(asRecord(asRecord(u.section.section_details).web).after_images)[u.viewport];
        return Number(asRecord(entry).attempts ?? 0);
      };
      const next = units.find((u) => !isDone(u));
      if (!next) {
        // All after images done (success or recorded error): let the report show.
        try { await sb.from("audits").update({ web_afters_ready: true }).eq("id", auditId); } catch { /* non-fatal */ }
        await autoPublishAudit(sb, auditId);
        return json({ ok: true, correlationId, status: "complete" });
      }

      const referenceAfterUrl =
        next.viewport !== next.primaryViewport ? afterUrlFor(next.section, next.primaryViewport) : undefined;
      try {
        await generateOne(sb, auditId, clientId, next.section, apiKey, next.viewport, next.url, referenceAfterUrl, next.fold2Url, next.elements);
      } catch (e) {
        // Count the attempt. Only the LAST one records a terminal error, so a
        // one-off "no image returned" gets retried on the next chained hop
        // instead of leaving the page permanently without an after image.
        const attempts = attemptsFor(next) + 1;
        const message = String(e instanceof Error ? e.message : e).slice(0, 200);
        const terminal = attempts >= MAX_UNIT_ATTEMPTS;
        const details = asRecord(next.section.section_details);
        const webOut = asRecord(details.web);
        const afterImages = asRecord(webOut.after_images);
        afterImages[next.viewport] = {
          url: null,
          attempts,
          last_error: message,
          // Setting `error` is what marks the unit done, so hold it back until
          // the attempts are used up.
          ...(terminal ? { error: message } : {}),
          generated_at: new Date().toISOString(),
        };
        webOut.after_images = afterImages;
        details.web = webOut;
        await sb.from("audit_sections").update({ section_details: details }).eq("id", next.section.id);
        next.section.section_details = details;
        console.error("after-image attempt failed", next.section.section_key, next.viewport, attempts, message);
      }
      const remaining = units.some((u) => !isDone(u));
      if (remaining) await chainAuto(auditId);
      else {
        // Last unit just finished: reveal the report.
        try { await sb.from("audits").update({ web_afters_ready: true }).eq("id", auditId); } catch { /* non-fatal */ }
        await autoPublishAudit(sb, auditId);
      }
      return json({ ok: true, correlationId, status: remaining ? "in_progress" : "complete", section: next.section.section_key, viewport: next.viewport });
    }

    return json({ ok: false, error: { code: "bad_request", message: "Provide section_key or mode:auto" }, correlationId }, { status: 400 });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "Unknown error";
    // Surface an out-of-credits / quota failure as a readable message with a 200,
    // so the report shows what is actually wrong instead of the client's generic
    // "Edge Function returned a non-2xx status code".
    const outOfCredits = /prepayment credits|quota|billing|RESOURCE_EXHAUSTED|gemini_http_429/i.test(raw);
    if (outOfCredits) {
      return json({
        ok: false,
        error: {
          code: "quota_exhausted",
          message: "Image generation is out of credits on the Gemini account. Top up billing in Google AI Studio, then try again.",
        },
        correlationId,
      }, { status: 200 });
    }
    return json({ ok: false, error: { code: "generate_failed", message: raw }, correlationId }, { status: 500 });
  }
});
