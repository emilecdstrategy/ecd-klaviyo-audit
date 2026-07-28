// One unit of the after-image model bake-off: generate ONE candidate image for
// ONE test case with a chosen model, store it under bakeoff/ (never a canonical
// after_* path), grade it with the production verifier, and return the verdict.
// A local script orchestrates the full matrix; this exists because the provider
// API keys live encrypted in app_secrets and can only be decrypted here.
//
// Service-role only: this endpoint spends real image-generation money.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";
import { type WebPageKind } from "../_shared/ecommerce-ux-kb.ts";
import {
  buildEditPrompt,
  geminiEditImage,
  photoShapeNote,
  pngSize,
  wrongShape,
  type CapturedEl,
  type Viewport,
} from "../_shared/after-image-prompt.ts";
import { verifyAfterImage, verifyScore, isPhotoDefect, type VerifyResult } from "../_shared/after-image-verify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-3.1-flash-image";
const STORAGE_BUCKET = "audit-assets";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

type Candidate = "gemini-flash" | "gemini-flash-bestof2" | "gemini-pro" | "gpt-image-1";

/** The best available Gemini image model above the flash tier, if any. */
async function findProImageModel(apiKey: string): Promise<string | null> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> } | null;
  const names = (data?.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((n) => /image/i.test(n) && !/embedding/i.test(n));
  // Prefer a pro tier; refuse to "discover" the model we already run as flash.
  const pro = names.filter((n) => /pro/i.test(n) && n !== GEMINI_IMAGE_MODEL);
  pro.sort().reverse(); // latest version string first
  return pro[0] ?? null;
}

/** OpenAI image edit: one input image, one prompt, PNG out. */
async function openaiEditImage(sourcePng: Uint8Array, prompt: string, apiKey: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", new Blob([sourcePng.slice().buffer as ArrayBuffer], { type: "image/png" }), "source.png");
  // gpt-image-1 caps the prompt length; production prompts are ~9-10k chars so
  // this is headroom, not truncation in practice.
  form.append("prompt", prompt.slice(0, 30000));
  form.append("size", "auto");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("openai_timeout");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`openai_http_${res.status}: ${detail}`);
  }
  const data = await res.json().catch(() => null) as { data?: Array<{ b64_json?: string }> } | null;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("openai_no_image_returned");
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: { code: "method_not_allowed" } }, { status: 405 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !isServiceRoleAuthorization(token)) {
    return json({ ok: false, error: { code: "forbidden" } }, { status: 403 });
  }

  try {
    const input = (await req.json()) as {
      action?: "list_models" | "generate";
      candidate?: Candidate;
      source_url?: string;
      below_fold_url?: string | null;
      elements?: CapturedEl[];
      recommendations?: string[];
      viewport?: Viewport;
      page_kind?: WebPageKind;
      label?: string;
      out_path?: string;
    };

    if (input.action === "list_models") {
      const geminiKey = await getSecret("gemini_api_key");
      if (!geminiKey) return json({ ok: false, error: { code: "no_gemini_key" } }, { status: 200 });
      const pro = await findProImageModel(geminiKey);
      return json({ ok: true, flash: GEMINI_IMAGE_MODEL, pro });
    }

    const candidate = input.candidate;
    const sourceUrl = (input.source_url ?? "").trim();
    const viewport = input.viewport === "mobile" ? "mobile" : "desktop";
    const recommendations = (input.recommendations ?? []).map(String).filter(Boolean);
    const outPath = (input.out_path ?? "").trim();
    if (!candidate || !sourceUrl || !outPath || !input.page_kind || !input.label) {
      return json({ ok: false, error: { code: "bad_request", message: "candidate, source_url, out_path, page_kind, label required" } }, { status: 400 });
    }
    // Hard rail: this function must never write anywhere near production images.
    if (!outPath.startsWith("bakeoff/") || outPath.includes("..")) {
      return json({ ok: false, error: { code: "bad_request", message: "out_path must live under bakeoff/" } }, { status: 400 });
    }

    const srcRes = await fetch(sourceUrl);
    if (!srcRes.ok) return json({ ok: false, error: { code: "fetch_source", message: `HTTP ${srcRes.status}` } }, { status: 200 });
    const srcPng = new Uint8Array(await srcRes.arrayBuffer());

    let belowPng: Uint8Array | undefined;
    if (input.below_fold_url) {
      try {
        const r = await fetch(input.below_fold_url);
        if (r.ok) belowPng = new Uint8Array(await r.arrayBuffer());
      } catch { /* context image is optional */ }
    }

    // The exact production prompt. All candidates run standalone (no sibling
    // reference) so every model faces the identical task.
    const prompt = buildEditPrompt(
      input.label,
      recommendations,
      false,
      viewport,
      input.page_kind,
      false,
      Boolean(belowPng),
      photoShapeNote(input.elements, pngSize(srcPng)),
    );

    const geminiKey = await getSecret("gemini_api_key");
    const openaiKey = await getSecret("openai_api_key");

    const t0 = Date.now();
    let images: Uint8Array[] = [];
    let modelUsed = "";
    if (candidate === "gemini-flash" || candidate === "gemini-flash-bestof2") {
      if (!geminiKey) return json({ ok: false, error: { code: "no_gemini_key" } }, { status: 200 });
      modelUsed = GEMINI_IMAGE_MODEL;
      images = await geminiEditImage(srcPng, prompt, geminiKey, {
        model: GEMINI_IMAGE_MODEL,
        belowFoldPng: belowPng,
        candidateCount: candidate === "gemini-flash-bestof2" ? 2 : undefined,
      });
    } else if (candidate === "gemini-pro") {
      if (!geminiKey) return json({ ok: false, error: { code: "no_gemini_key" } }, { status: 200 });
      const pro = await findProImageModel(geminiKey);
      if (!pro) return json({ ok: true, skipped: "no pro-tier image model available on this key" });
      modelUsed = pro;
      images = await geminiEditImage(srcPng, prompt, geminiKey, { model: pro, belowFoldPng: belowPng });
    } else {
      if (!openaiKey) return json({ ok: false, error: { code: "no_openai_key" } }, { status: 200 });
      modelUsed = "gpt-image-1";
      // Capability difference, reported as such: gpt-image-1 accepts one input
      // image, so the below-fold context cannot be attached.
      images = [await openaiEditImage(srcPng, prompt, openaiKey)];
    }
    const genMs = Date.now() - t0;

    // Store each produced image and grade it with the production verifier.
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const results: Array<{
      url: string;
      shapeOk: boolean;
      verdict: VerifyResult;
      score: number;
      photoDefects: number;
      width: number | null;
      height: number | null;
    }> = [];
    for (let i = 0; i < images.length; i++) {
      const bytes = images[i];
      const path = images.length > 1 ? outPath.replace(/\.png$/, `_c${i + 1}.png`) : outPath;
      const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
      if (upErr) return json({ ok: false, error: { code: "upload_failed", message: upErr.message } }, { status: 200 });
      const { data: pub } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const url = pub?.publicUrl ?? "";
      const verdict = await verifyAfterImage(sourceUrl, url, recommendations, viewport);
      const size = pngSize(bytes);
      results.push({
        url,
        shapeOk: !wrongShape(srcPng, bytes),
        verdict,
        score: verifyScore(verdict),
        photoDefects: verdict.defects.filter(isPhotoDefect).length,
        width: size?.w ?? null,
        height: size?.h ?? null,
      });
    }
    // For best-of-N the caller cares about the winner, but gets every candidate.
    results.sort((a, b) => a.score - b.score);

    return json({
      ok: true,
      model: modelUsed,
      generation_ms: genMs,
      prompt_chars: prompt.length,
      results,
    });
  } catch (e) {
    return json({ ok: false, error: { code: "request_failed", message: e instanceof Error ? e.message : "Unknown error" } }, { status: 200 });
  }
});

