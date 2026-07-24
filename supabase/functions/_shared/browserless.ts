/**
 * Browserless (https://browserless.io) headless-browser pass. One /function call
 * renders the page and returns a screenshot (viewport or full-page) plus, for the
 * viewport shot, the real bounding boxes of the page's elements measured at that
 * same render, so findings can pin an actual element instead of a guessed
 * coordinate.
 *
 * When BROWSERLESS_TOKEN is set this replaces ScreenshotOne for web audits
 * entirely (blockAds + blockConsentModals give ad / cookie-banner blocking; we
 * also strip leftover chat widgets and fixed overlays in code, and can click a
 * selector for the cart drawer). ScreenshotOne stays as the fallback when the
 * token is absent or a Browserless call fails.
 */

export type CapturedElement = { id: string; label: string; x: number; y: number; w: number; h: number };
export type BrowserlessResult =
  | { ok: true; png: Uint8Array; elements: CapturedElement[]; cartCount?: number | null }
  | { ok: false; error: string };

const DIMENSIONS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export function browserlessEnabled(): boolean {
  return Boolean((Deno.env.get("BROWSERLESS_TOKEN") ?? "").trim());
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Puppeteer module run inside Browserless. Kept as a plain string so it ships to
// /function as-is. blockAds/blockConsentModals (launch params on the URL) handle
// ads + cookie banners; this code adds a chat-widget / leftover-overlay sweep, an
// optional cart-drawer click, and (for the viewport shot) element-box collection.
const FUNCTION_CODE = `
export default async ({ page, context }) => {
  const { url, width, height, fullPage, withElements, cartAdd, isMobile } = context;
  // Some storefronts serve a blank page or bot-block the default HeadlessChrome
  // UA at a phone viewport, so emulate a real iPhone (UA + touch) for mobile.
  if (isMobile) {
    try {
      await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    } catch (e) {}
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  } else {
    // Use a real desktop Chrome UA (not HeadlessChrome) — storefront bot
    // protection blocks the default headless UA on XHRs like /cart/add.js.
    try {
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
    } catch (e) {}
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
  }
  const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 55000 });

  // Shopify storefronts IP-rate-limit rapid hits by serving a plain-text
  // "local_rate_limited" page (often with a 2xx render), which would otherwise
  // be screenshotted and stored as a "successful" capture. Detect it (and other
  // bare error bodies) and bail out so the caller requeues instead of storing
  // a picture of an error message.
  const httpStatus = resp ? resp.status() : 0;
  const bodyText = await page
    .evaluate(() => ((document.body && document.body.innerText) || "").trim().slice(0, 300))
    .catch(() => "");
  const looksLikeErrorPage =
    bodyText.length < 280 &&
    /local_rate_limited|too many requests|rate.?limited|access denied|error 10\d\d|connection needs to be verified|verify you are human|checking your browser|just a moment|attention required|enable javascript and cookies|captcha/i.test(bodyText);
  if (httpStatus >= 400 || looksLikeErrorPage) {
    return { data: { error: "storefront_blocked (http " + httpStatus + ": " + bodyText.slice(0, 90) + ")" }, type: "application/json" };
  }

  // Strip leftover fixed overlays that blockConsentModals may miss, plus common
  // live-chat / support launchers so they don't cover real content.
  const sweep = () => {
    const sels = [
      '[id*="cookie" i]','[class*="cookie" i]','[id*="consent" i]','[class*="consent" i]','[class*="gdpr" i]',
      '[id*="intercom" i]','[class*="intercom" i]','[id*="drift" i]','[class*="drift" i]',
      '[class*="tawk" i]','[id*="tawk" i]','[class*="crisp" i]','[id*="crisp" i]',
      '[class*="gorgias" i]','[id*="gorgias" i]','[class*="livechat" i]','[id*="livechat" i]',
      '[aria-label*="chat" i]','[class*="chat-widget" i]','[class*="help-widget" i]'
    ];
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => {
        try {
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky" || Number(cs.zIndex) > 1000) el.remove();
        } catch (e) {}
      });
    }
  };
  // Remove newsletter / promo / email-capture modals + their backdrops so they
  // don't cover the page. NEVER touch cart/drawer elements (the cart capture
  // needs the slide-cart drawer visible).
  const sweepPopups = () => {
    const sels = [
      '[role="dialog"]','[aria-modal="true"]',
      '[class*="modal" i]','[id*="modal" i]','[class*="popup" i]','[id*="popup" i]',
      '[class*="newsletter" i]','[id*="newsletter" i]','[class*="subscribe" i]','[class*="signup" i]',
      '[class*="optin" i]','[class*="email-capture" i]','[class*="lightbox" i]',
      '[class*="klaviyo" i]','[class*="kl-private" i]','[class*="needsclick" i]',
      '[class*="privy" i]','[id*="om-" i]','[class*="justuno" i]','[class*="attentive" i]','[class*="wisepops" i]',
      '[class*="backdrop" i]','[class*="overlay" i]'
    ];
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => {
        try {
          const idc = ((el.getAttribute("class") || "") + " " + (el.id || ""));
          if (/cart|minicart|drawer/i.test(idc)) return; // keep the cart drawer
          const cs = getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky" || Number(cs.zIndex) > 1000) el.remove();
        } catch (e) {}
      });
    }
  };
  await page.evaluate(sweep).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {}); // closes many popups
  await page.evaluate(sweepPopups).catch(() => {});

  // Trigger lazy-loaded media (common on mobile heroes and Shopify sections that
  // load images on scroll) by stepping down the page, then return to the top so
  // the above-the-fold viewport shot is fully painted instead of blank.
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        window.scrollTo(0, y);
        y += Math.max(600, window.innerHeight);
        if (y < document.body.scrollHeight && y < 15000) setTimeout(step, 150);
        else { window.scrollTo(0, 0); setTimeout(resolve, 300); }
      };
      step();
    });
  }).catch(() => {});
  // Let images that just entered the viewport decode after scrolling back to top.
  await new Promise((r) => setTimeout(r, 1500));
  // Many newsletter popups fire on a delay / after scroll — dismiss again.
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(sweepPopups).catch(() => {});

  // Cart: add the product via Shopify's AJAX API (stays on the page), then click
  // a cart trigger. On drawer themes this opens the slide-cart drawer; on
  // page-based themes it navigates to the populated /cart page (we force /cart as
  // a last resort). Either way we get a POPULATED cart, never the checkout the
  // /cart/{variant}:1 permalink would land on.
  let cartCount = null;
  if (cartAdd) {
    try {
      // 1) Determine a variant to add. Prefer the one we detected; else read a
      //    real variant id off the product page; else pull any available variant.
      let variantId = cartAdd.variantId ? String(cartAdd.variantId) : null;
      if (!variantId && cartAdd.productUrl) {
        try {
          await page.goto(cartAdd.productUrl, { waitUntil: "networkidle2", timeout: 30000 });
          variantId = await page.evaluate(() => {
            const input = document.querySelector('form[action*="/cart/add"] [name="id"], [name="id"]');
            if (input && input.value) return String(input.value);
            try {
              const m = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
              const v = m && m.product && m.product.variants && m.product.variants[0];
              if (v && v.id) return String(v.id);
            } catch (e) {}
            return null;
          });
        } catch (e) {}
      }
      if (!variantId) {
        variantId = await page.evaluate(async () => {
          try {
            const res = await fetch("/products.json?limit=30");
            const data = await res.json();
            for (const p of (data.products || [])) {
              const v = (p.variants || []).find((x) => x.available) || (p.variants || [])[0];
              if (v && v.id) return String(v.id);
            }
          } catch (e) {}
          return null;
        });
      }

      // 2) Add via the cart PERMALINK, a normal navigation (not an XHR), so
      //    storefront bot protection is far less likely to block it than
      //    /cart/add.js. This lands on /cart with the item in the cart cookie.
      if (variantId) {
        try { await page.goto(new URL("/cart/" + variantId + ":1", url).href, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
      }
      // Belt-and-suspenders: also try the AJAX add in case the permalink did not stick.
      if (variantId) {
        try {
          await page.evaluate(async (id) => {
            const tryBody = async (body) => {
              try {
                const r = await fetch("/cart/add.js", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(body) });
                return r.ok;
              } catch (e) { return false; }
            };
            if (await tryBody({ items: [{ id: Number(id), quantity: 1 }] })) return true;
            return await tryBody({ id: Number(id), quantity: 1 });
          }, variantId);
        } catch (e) {}
      }

      // 3) Confirm the cart actually has an item.
      cartCount = await page.evaluate(async () => {
        for (let i = 0; i < 12; i++) {
          try { const c = await (await fetch("/cart.js")).json(); if (c && c.item_count > 0) return c.item_count; } catch (e) {}
          await new Promise((r) => setTimeout(r, 600));
        }
        try { const c = await (await fetch("/cart.js")).json(); return (c && typeof c.item_count === "number") ? c.item_count : -1; } catch (e) { return -1; }
      }).catch(() => -1);

      // 4) Open the slide-cart drawer: return to the homepage (where the cart icon
      //    lives) and click a cart trigger. The item persists via the cart cookie.
      try { await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
      await page.evaluate(sweep).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(sweepPopups).catch(() => {});
      // Prefer drawer-opening toggles (buttons) FIRST; the plain /cart links are
      // last because clicking them navigates to the cart page instead of opening
      // the slide-cart drawer.
      const triggers = [
        '[data-cart-toggle]','.js-drawer-open-cart','[class*="cart-toggle" i]',
        'button[aria-label*="cart" i]','button[class*="cart" i]','[class*="cart-icon" i]',
        '[aria-label*="cart" i]','a[href$="/cart"]','a[href*="/cart"]',
      ];
      let opened = false;
      for (const t of triggers) {
        try {
          const el = await page.$(t);
          if (el) { await el.click(); opened = true; await new Promise((r) => setTimeout(r, 2800)); break; }
        } catch (e) {}
      }
      // If no drawer opened, fall back to the populated /cart page.
      if (!opened) {
        try { await page.goto(new URL("/cart", url).href, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
      }
    } catch (e) {}
  }

  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(sweep).catch(() => {});
  // Final popup sweep (keeps the cart drawer; no Escape here so we don't close it).
  await page.evaluate(sweepPopups).catch(() => {});

  let elements = [];
  if (withElements) {
    elements = await page.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const sel = 'h1,h2,h3,h4,button,a,nav,header,[role="button"],img,input,select,textarea,[class*="cart" i],[class*="hero" i],[class*="cta" i],[class*="banner" i],[class*="search" i],[class*="review" i],[class*="price" i],[class*="badge" i]';
      const nodes = Array.from(document.querySelectorAll(sel));
      const seen = [];
      const out = [];
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
        const left = Math.max(0, r.left), top = Math.max(0, r.top);
        const right = Math.min(vw, r.right), bottom = Math.min(vh, r.bottom);
        const w = right - left, h = bottom - top;
        if (w < 24 || h < 12 || w * h < 700) continue;
        const key = [Math.round(left/8), Math.round(top/8), Math.round(w/8), Math.round(h/8)].join(",");
        if (seen.indexOf(key) !== -1) continue;
        seen.push(key);
        const tag = el.tagName.toLowerCase();
        // innerText = visible text only (skips <style>/<script> content that
        // textContent would leak into labels).
        let text = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim();
        if (text.indexOf("{") !== -1 && text.indexOf("}") !== -1) text = ""; // leaked CSS
        text = text.slice(0, 60);
        if (!text && tag === "img") text = "image";
        out.push({
          tag, text,
          x: +(left / vw * 100).toFixed(2), y: +(top / vh * 100).toFixed(2),
          w: +(w / vw * 100).toFixed(2), h: +(h / vh * 100).toFixed(2),
        });
      }
      out.sort((a, b) => (b.w * b.h) - (a.w * a.h));
      return out.slice(0, 60)
        .sort((a, b) => (a.y - b.y) || (a.x - b.x))
        .map((e, i) => ({ id: "el_" + (i + 1), label: e.tag + (e.text ? ": " + e.text : ""), x: e.x, y: e.y, w: e.w, h: e.h }));
    });
  }

  // Final guard: cart flow navigates a few times; if any hop landed on a bot
  // challenge / error page, bail so the caller requeues instead of storing a
  // picture of the block. (Real pages have far more than 280 chars of text.)
  const finalText = await page
    .evaluate(() => ((document.body && document.body.innerText) || "").trim().slice(0, 300))
    .catch(() => "");
  if (
    finalText.length < 280 &&
    /local_rate_limited|too many requests|rate.?limited|access denied|error 10\d\d|connection needs to be verified|verify you are human|checking your browser|just a moment|attention required|enable javascript and cookies|captcha/i.test(finalText)
  ) {
    return { data: { error: "storefront_blocked (final: " + finalText.slice(0, 90) + ")" }, type: "application/json" };
  }

  const screenshot = await page.screenshot({ encoding: "base64", fullPage: !!fullPage, captureBeyondViewport: !!fullPage });
  return { data: { screenshot, elements, cartCount }, type: "application/json" };
};
`;

export async function captureWithBrowserless(input: {
  url: string;
  viewport: "desktop" | "mobile";
  fullPage: boolean;
  withElements: boolean;
  /** When set, add the variant to the cart and open the slide-cart drawer.
   * productUrl lets the capture read a real variant off the product page when no
   * variantId is known. */
  cartAdd?: { variantId?: string | null; productUrl?: string | null };
}): Promise<BrowserlessResult> {
  const token = (Deno.env.get("BROWSERLESS_TOKEN") ?? "").trim();
  if (!token) return { ok: false, error: "browserless_token_missing" };
  const base = (Deno.env.get("BROWSERLESS_BASE_URL") ?? "https://production-sfo.browserless.io").replace(/\/$/, "");
  const dim = DIMENSIONS[input.viewport];
  // The /function endpoint only accepts `token` as a query param (launch flags
  // like blockAds/blockConsentModals are for /screenshot and 400 here). Cookie
  // banners + chat widgets are removed in-code by the sweep() in FUNCTION_CODE.
  const qs = new URLSearchParams({ token });
  // Route through Browserless residential proxies when enabled. Shopify
  // storefronts rate-limit/block datacenter IPs (the 429 "local_rate_limited"
  // page); a residential IP looks like a normal shopper and gets served.
  // BROWSERLESS_PROXY=residential turns it on; sticky keeps one IP per capture.
  const proxy = (Deno.env.get("BROWSERLESS_PROXY") ?? "").trim();
  if (proxy) {
    qs.set("proxy", proxy);
    qs.set("proxySticky", "true");
    const country = (Deno.env.get("BROWSERLESS_PROXY_COUNTRY") ?? "us").trim();
    if (country) qs.set("proxyCountry", country);
  }

  const ctrl = new AbortController();
  // Residential proxies add latency, so allow more time when one is in use
  // (must exceed the in-page goto timeout + scroll/settle, and stay under the
  // edge runtime wall-clock limit since it's a single attempt per invocation).
  const timer = setTimeout(() => ctrl.abort(), proxy ? 90_000 : 45_000);
  try {
    const res = await fetch(`${base}/function?${qs.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: FUNCTION_CODE,
        context: {
          url: input.url,
          width: dim.width,
          height: dim.height,
          fullPage: input.fullPage,
          withElements: input.withElements,
          cartAdd: input.cartAdd ?? null,
          isMobile: input.viewport === "mobile",
        },
      }),
      signal: ctrl.signal,
    });
    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `browserless_http_${res.status}${rawText ? `: ${rawText.slice(0, 140)}` : ""}` };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    // /function returns the whole { data, type } wrapper as the JSON body, so the
    // real payload is under .data (fall back to the root if that ever changes).
    const wrapper = parsed as { data?: unknown } | null;
    const payload = (wrapper && typeof wrapper.data === "object" ? wrapper.data : wrapper) as
      | { screenshot?: string; elements?: CapturedElement[]; error?: string; cartCount?: number | null }
      | null;
    // In-page detection (storefront rate-limit / bot-block page) reports a
    // structured error instead of a screenshot.
    if (payload?.error) return { ok: false, error: String(payload.error) };
    if (!payload?.screenshot) return { ok: false, error: "browserless_no_screenshot" };
    const png = b64ToBytes(payload.screenshot);
    if (png.byteLength < 5000) return { ok: false, error: "browserless_blank_page" };
    const elements = Array.isArray(payload.elements) ? payload.elements.slice(0, 60) : [];
    return { ok: true, png, elements, cartCount: payload.cartCount ?? null };
  } catch (e) {
    const msg = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))
      ? "browserless_timeout"
      : (e instanceof Error ? e.message : "browserless_failed");
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
