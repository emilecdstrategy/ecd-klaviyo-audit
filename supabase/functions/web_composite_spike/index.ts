import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";
import { getSecret } from "../_shared/app-secrets.ts";
import { buildEditPrompt, geminiEditImage, type Viewport } from "../_shared/after-image-prompt.ts";
import { maskPhotos, restorePhotos, lockSlotsPrompt, type PhotoBox } from "../_shared/after-composite.ts";
import type { WebPageKind } from "../_shared/ecommerce-ux-kb.ts";

// Test harness for the photo-lock compositor. Takes a snapshot that carries the
// capture-time photo inventory (raw.photos), masks every photo to a magenta
// slot, runs the EXACT production prompt plus the lock paragraph through
// Gemini, then pastes the original photos back into the slots the model kept.
//
// It exists to answer ONE question before the real pipeline is wired: does the
// model reliably carry solid placeholder rectangles through a redesign? Every
// artifact (masked input, raw model output, composited result) is stored under
// bakeoff/ so the answer is a set of images plus a per-slot report, not a vibe.
//
// Service-role only; never writes a canonical after_* path or any audit row.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_IMAGE_MODEL = Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-3.1-flash-image";
const BUCKET = "audit-assets";

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !isServiceRoleAuthorization(token)) return new Response("forbidden", { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    snapshot_id?: string;
    recommendations?: string[];
    case?: string;
  };
  const snapshotId = String(body.snapshot_id ?? "").trim();
  const recommendations = (Array.isArray(body.recommendations) ? body.recommendations : [])
    .map((r) => String(r).trim())
    .filter(Boolean);
  if (!snapshotId || recommendations.length === 0) {
    return json({ ok: false, error: "snapshot_id and recommendations are required" });
  }
  const label = String(body.case ?? "case").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "case";
  const startedAt = Date.now();

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: snap, error } = await sb
      .from("web_page_snapshots")
      .select("id, page_type, viewport, screenshot_url, raw")
      .eq("id", snapshotId)
      .single();
    if (error || !snap) return json({ ok: false, error: `snapshot_not_found: ${error?.message ?? ""}` });

    const photos = ((snap.raw as Record<string, unknown> | null)?.photos ?? []) as PhotoBox[];
    if (!Array.isArray(photos) || photos.length === 0) {
      return json({ ok: false, error: "snapshot_has_no_photo_inventory (recapture it first)" });
    }
    if (!snap.screenshot_url) return json({ ok: false, error: "snapshot_has_no_screenshot" });

    const srcRes = await fetch(snap.screenshot_url as string);
    if (!srcRes.ok) return json({ ok: false, error: `fetch_source_${srcRes.status}` });
    const sourcePng = new Uint8Array(await srcRes.arrayBuffer());

    // 1. Mask: the model never sees a real photo.
    const masked = await maskPhotos(sourcePng, photos);

    // 2. Generate with the EXACT production prompt plus the lock paragraph.
    const viewport = (snap.viewport === "desktop" ? "desktop" : "mobile") as Viewport;
    const pageKind = (["homepage", "product", "collection", "cart"].includes(String(snap.page_type))
      ? snap.page_type
      : "homepage") as WebPageKind;
    const prompt = [
      buildEditPrompt(String(snap.page_type), recommendations, false, viewport, pageKind),
      lockSlotsPrompt(photos.length),
    ].join("\n\n");
    const apiKey = (await getSecret("gemini_api_key")).trim();
    const genStarted = Date.now();
    const candidates = await geminiEditImage(masked.png, prompt, apiKey, { model: GEMINI_IMAGE_MODEL });
    const generated = candidates[0];
    if (!generated) return json({ ok: false, error: "gemini_no_image" });

    // 3. Restore: original pixels into every slot the model kept.
    const restored = await restorePhotos(sourcePng, generated, photos);

    const stamp = `${Date.now()}`;
    const base = `bakeoff/composite-spike/${stamp}-${label}`;
    const urls: Record<string, string> = {};
    for (const [name, bytes] of [
      ["masked", masked.png],
      ["raw", generated],
      ["composited", restored.png],
    ] as Array<[string, Uint8Array]>) {
      const path = `${base}-${name}.png`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, {
        contentType: "image/png",
        upsert: true,
      });
      if (!upErr) urls[name] = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }

    const found = restored.report.filter((r) => r.found).length;
    return json({
      ok: true,
      snapshot: { id: snap.id, page_type: snap.page_type, viewport: snap.viewport },
      slots: { total: photos.length, restored: found },
      report: restored.report,
      urls,
      timings_ms: { total: Date.now() - startedAt, generate: Date.now() - genStarted },
    });
  } catch (e) {
    return json({ ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
  }
});

function json(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}
