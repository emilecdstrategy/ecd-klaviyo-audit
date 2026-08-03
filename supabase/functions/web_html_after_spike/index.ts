import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceRoleAuthorization } from "../_shared/auth.ts";
import { captureWithBrowserless } from "../_shared/browserless.ts";

// ONE-PAGE SPIKE for the HTML-afters architecture, before committing to the
// rebuild: instead of asking an image model to repaint the screenshot, load the
// real page in Browserless, apply the fixes as DOM/CSS edits, and re-shoot it.
// Photos, fonts, colors and the logo are the site's own, so nothing can go
// off-brand or get re-cropped by construction.
//
// The edits below are hand-written for lazyleaf.com/collections/bundles-kits,
// mirroring the audit's actual findings for that page (benefit line under the
// title, quick add-to-cart on each card). In the full build Claude writes this
// script from the findings plus a DOM outline; the spike tests RENDERING
// fidelity, which is the part the image model kept failing.
//
// Service-role only, stores under bakeoff/ (never a canonical after_* path).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "audit-assets";

const EDIT_SCRIPT = `
// --- Fix 3 (finding): benefit line under the plain collection title ---------
const heads = Array.from(document.querySelectorAll("h1, h2, [class*='banner'] [class*='title'], [class*='collection'] h1"));
const title = heads.find((h) => /bundles\\s*&\\s*kits/i.test(h.textContent || "") && h.getClientRects().length);
if (title && !document.getElementById("ecd-sub")) {
  const sub = document.createElement("span");
  sub.id = "ecd-sub";
  sub.textContent = "Keep heavy planters rolling, no more back strain";
  sub.style.cssText = "display:block;margin-top:8px;font-size:15px;font-weight:400;letter-spacing:normal;" +
    "line-height:1.4;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.55);font-family:" +
    getComputedStyle(document.body).fontFamily + ";";
  title.appendChild(sub);
}

// --- Fix 2 (finding): quick add-to-cart on every product card ---------------
// Style is CLONED from the theme's own button and colour tokens, never guessed:
// that is the deterministic answer to "will it stay on brand".
const root = getComputedStyle(document.documentElement);
const tokenBtn = (root.getPropertyValue("--colors-button") || "").trim();
const tokenBtnText = (root.getPropertyValue("--colors-button-text") || "").trim();
const donor = document.querySelector(".button--quickview, button[class*='button']:not([class*='menu'])");
const d = donor ? getComputedStyle(donor) : null;
const solid = (c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
const bg = tokenBtn ? "rgb(" + tokenBtn + ")" : (d && solid(d.backgroundColor) ? d.backgroundColor : "#2f7a55");
const fg = tokenBtnText ? "rgb(" + tokenBtnText + ")" : "#ffffff";
const radius = d && d.borderRadius && d.borderRadius !== "0px" ? d.borderRadius : "9999px";
const font = d ? d.fontFamily : getComputedStyle(document.body).fontFamily;

document.querySelectorAll(".card-product").forEach((card) => {
  if (card.querySelector(".ecd-atc")) return;
  const info = card.querySelector(".card-info") || card;
  const btn = document.createElement("button");
  btn.className = "ecd-atc";
  btn.textContent = "Add to cart";
  btn.style.cssText = "display:block;width:100%;margin-top:10px;padding:10px 12px;border:0;border-radius:" + radius +
    ";background:" + bg + ";color:" + fg + ";font-family:" + font + ";font-size:14px;font-weight:600;cursor:pointer;";
  info.appendChild(btn);
});
`;

serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !isServiceRoleAuthorization(token)) return new Response("forbidden", { status: 403 });

  const result = await captureWithBrowserless({
    url: "https://lazyleaf.com/collections/bundles-kits",
    viewport: "mobile",
    fullPage: false,
    withElements: false,
    secondFold: true,
    editScript: EDIT_SCRIPT,
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: result.error }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const path = `bakeoff/html-after-spike/collection_mobile_${Date.now()}.png`;
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, result.png, { contentType: "image/png", upsert: true });
  if (upErr) {
    return new Response(JSON.stringify({ ok: false, error: `upload: ${upErr.message}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  let url2: string | null = null;
  if (result.png2) {
    const path2 = path.replace(".png", "_fold2.png");
    const { error: up2 } = await sb.storage
      .from(BUCKET)
      .upload(path2, result.png2, { contentType: "image/png", upsert: true });
    if (!up2) url2 = sb.storage.from(BUCKET).getPublicUrl(path2).data?.publicUrl ?? null;
  }
  return new Response(JSON.stringify({ ok: true, url: pub?.publicUrl ?? null, url2 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
