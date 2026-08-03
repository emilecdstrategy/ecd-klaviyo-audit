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
  | {
    ok: true;
    png: Uint8Array;
    png2?: Uint8Array | null;
    elements: CapturedElement[];
    cartCount?: number | null;
    /** The proxy pool that actually served this capture ("" for none). Recorded
     * per snapshot so the datacenter-vs-residential spend is auditable rather
     * than assumed from BROWSERLESS_PROXY. */
    proxyUsed?: string;
    /** Return value of `probeScript` (the DOM outline, when asked for). */
    probe?: unknown;
    /** Return value of `editScript`: which edits actually landed. */
    editReport?: unknown;
  }
  | { ok: false; error: string; proxyUsed?: string };

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
  const { url, width, height, fullPage, withElements, cartAdd, isMobile, secondFold, editScript, probeScript } = context;
  if (editScript) {
    // Must be set before navigation; lets our injected edits run on stores
    // whose CSP would otherwise reject evaluated scripts.
    try { await page.setBypassCSP(true); } catch (e) {}
  }
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

      // 4) Open the slide-cart drawer: go to a NON-cart page (the cart icon lives
      //    in the header there) and click a cart trigger. The item persists via
      //    the cart cookie. Using the storefront root when the configured cart
      //    target is itself /cart matters: a drawer cannot open on the cart page,
      //    which previously left us screenshotting the full /cart page instead.
      let drawerBase = url;
      try {
        const u = new URL(url);
        if (/^\\/cart(\\/|$)/.test(u.pathname)) drawerBase = u.origin + "/";
      } catch (e) {}
      try { await page.goto(drawerBase, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
      await page.evaluate(sweep).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(sweepPopups).catch(() => {});
      // Prefer drawer-opening toggles (buttons) FIRST; the plain /cart links are
      // last because clicking them navigates to the cart page instead of opening
      // the slide-cart drawer.
      const triggers = [
        '[data-cart-toggle]','.js-drawer-open-cart','[class*="cart-toggle" i]',
        'button[aria-label*="cart" i]','button[class*="cart" i]',
        '#cart-icon-bubble','#CartButton','[data-cart-drawer-toggle]',
        '[class*="cart-icon" i]',
        '[aria-label*="cart" i]','a[href$="/cart"]','a[href*="/cart"]',
      ];

      // On most themes (and on desktop especially) the cart icon is a plain
      // <a href="/cart">: the theme's own JS opens the drawer, but the browser
      // ALSO follows the link, so we ended up on the /cart page. Swallow the
      // link's default action in the capture phase. preventDefault stops the
      // navigation but does NOT stop propagation, so the theme's own click
      // handler still runs and the drawer opens.
      const blockLinkNav = async (on) => {
        await page.evaluate((enable) => {
          if (enable) {
            window.__ecdBlockNav = function (e) {
              const t = e.target;
              const a = t && t.closest ? t.closest("a[href]") : null;
              if (a) e.preventDefault();
            };
            document.addEventListener("click", window.__ecdBlockNav, true);
          } else if (window.__ecdBlockNav) {
            document.removeEventListener("click", window.__ecdBlockNav, true);
            window.__ecdBlockNav = null;
          }
        }, on).catch(() => {});
      };
      // Is a slide-cart drawer actually on screen? A click alone proves nothing:
      // on many themes the cart icon is a plain <a href="/cart"> that navigates,
      // which used to be accepted as "opened" and gave us the /cart page instead.
      const drawerVisible = () => page.evaluate(() => {
        const sel = '[class*="drawer" i],[id*="drawer" i],[class*="mini-cart" i],[id*="mini-cart" i],'
          + '[class*="minicart" i],[id*="minicart" i],[class*="cart-modal" i],[class*="cart-popup" i],'
          + 'dialog[open],[role="dialog"],[aria-modal="true"]';
        const vw = window.innerWidth, vh = window.innerHeight;
        const nodes = Array.from(document.querySelectorAll(sel));
        for (const el of nodes) {
          const cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          if (parseFloat(cs.opacity || "1") < 0.1) continue;
          const r = el.getBoundingClientRect();
          // A real slide panel occupies a meaningful slice of the screen and is
          // actually within the viewport (a closed drawer sits translated off it).
          if (r.width < vw * 0.18 || r.height < vh * 0.25) continue;
          if (r.right <= 4 || r.left >= vw - 4 || r.bottom <= 4 || r.top >= vh - 4) continue;
          const txt = ((el.innerText || "") + "").toLowerCase();
          if (!/cart|subtotal|checkout/.test(txt)) continue;
          return true;
        }
        return false;
      }).catch(() => false);

      let opened = false;
      await blockLinkNav(true);
      for (const t of triggers) {
        try {
          const el = await page.$(t);
          if (!el) continue;
          const before = page.url();
          try { await el.click(); } catch (e) { continue; }
          await new Promise((r) => setTimeout(r, 2200));
          if (await drawerVisible()) {
            opened = true;
            await new Promise((r) => setTimeout(r, 700));
            break;
          }
          // The click navigated (typically to /cart) rather than opening a drawer.
          // Return to the page and try the next, more drawer-specific trigger.
          if (page.url() !== before) {
            try { await page.goto(drawerBase, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
            await page.evaluate(sweep).catch(() => {});
            await page.evaluate(sweepPopups).catch(() => {});
            // A fresh document dropped the listener, so re-arm it.
            await blockLinkNav(true);
          }
        } catch (e) {}
      }
      await blockLinkNav(false);
      // No drawer on this theme (or none would open): fall back to the populated
      // /cart page so we still show a real cart rather than an empty one.
      if (!opened) {
        try { await page.goto(new URL("/cart", url).href, { waitUntil: "networkidle2", timeout: 30000 }); } catch (e) {}
        await page.evaluate(sweep).catch(() => {});
        await page.evaluate(sweepPopups).catch(() => {});
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
      // Pass 2: short text chips built from plain divs and spans. Themes
      // routinely build category pills, tabs and badges out of non-semantic
      // markup, which pass 1 cannot see by tag or class. Only the innermost
      // node holding the text is taken, so a wrapper does not shadow the chip.
      const chips = [];
      const textNodes = Array.from(document.querySelectorAll("div,span,li,p"));
      for (const el of textNodes) {
        const t = ((el.innerText || "").replace(/\\s+/g, " ")).trim();
        if (!t || t.length > 40) continue;
        if (/[:]$/.test(t)) continue; // "Growing Zone:" and other label stubs
        let shadowed = false;
        for (const c of Array.from(el.children)) {
          if (((c.innerText || "").replace(/\\s+/g, " ")).trim() === t) { shadowed = true; break; }
        }
        if (!shadowed) chips.push(el);
      }
      const tagged = Array.from(document.querySelectorAll(sel));
      const nodes = tagged.concat(chips);
      const seen = [];
      const out = [];
      for (let ni = 0; ni < nodes.length; ni++) {
        const el = nodes[ni];
        const isChip = ni >= tagged.length;
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
          tag, text, chip: isChip,
          x: +(left / vw * 100).toFixed(2), y: +(top / vh * 100).toFixed(2),
          w: +(w / vw * 100).toFixed(2), h: +(h / vh * 100).toFixed(2),
        });
      }
      // Cap each pass separately. A single area-sorted cap would shed exactly
      // the small text chips pass 2 exists to catch, since they are the
      // smallest things on the page.
      const byArea = (a, b) => (b.w * b.h) - (a.w * a.h);
      const kept = out.filter((e) => !e.chip).sort(byArea).slice(0, 60)
        .concat(out.filter((e) => e.chip).sort(byArea).slice(0, 30));
      return kept
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

  // HTML-after mode: apply DOM/CSS edits to the REAL rendered page, then shoot
  // it. Photos, fonts, colors and the logo are the site's own assets, so brand
  // fidelity is by construction rather than by prompt. A failed script returns
  // an error instead of silently shooting the unedited page.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  // Read-only probe of the settled page (a DOM outline, for the HTML-after
  // author). Runs BEFORE any edits so it describes the page as shot, and never
  // fails a capture: a probe that throws just yields no outline.
  let probe = null;
  if (probeScript) {
    try {
      probe = await page.evaluate(new AsyncFunction(probeScript));
    } catch (e) {
      probe = { error: String(e && e.message || e).slice(0, 200) };
    }
  }

  // HTML-after mode: apply DOM/CSS edits to the REAL rendered page, then shoot
  // it. Photos, fonts, colors and the logo are the site's own assets, so brand
  // fidelity is by construction rather than by prompt. The script's return value
  // comes back as editReport, which is how the caller knows each edit actually
  // landed instead of trusting that it did.
  let editReport = null;
  if (editScript) {
    try {
      editReport = await page.evaluate(new AsyncFunction(editScript));
      await new Promise((r) => setTimeout(r, 700));
    } catch (e) {
      return { data: { error: "edit_script_failed: " + String(e && e.message || e).slice(0, 200) }, type: "application/json" };
    }
  }

  const screenshot = await page.screenshot({ encoding: "base64", fullPage: !!fullPage, captureBeyondViewport: !!fullPage });

  // Optional second fold: the same page, scrolled down one viewport. Costs one
  // scroll plus a screenshot in this same session (no extra page load, so no
  // extra rate-limit exposure). It is never shown in the report; it gives the
  // "after" image generator the real content that continues below the crop, so
  // it does not invent products or leave an empty band when content shifts up.
  let screenshot2 = null;
  if (secondFold && !fullPage) {
    try {
      await page.evaluate(() => { window.scrollTo(0, window.innerHeight); });
      await new Promise((r) => setTimeout(r, 900));
      await page.evaluate(sweepPopups).catch(() => {});
      const y = await page.evaluate(() => window.scrollY).catch(() => 0);
      // Only useful if the page actually scrolled (short pages have no fold 2).
      if (y > 40) screenshot2 = await page.screenshot({ encoding: "base64" });
      await page.evaluate(() => { window.scrollTo(0, 0); });
    } catch (e) {}
  }
  return { data: { screenshot, screenshot2, elements, cartCount, probe, editReport }, type: "application/json" };
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
  /** Also capture the next viewport down, as context for the "after" generator. */
  secondFold?: boolean;
  /** Which proxy pool to use, when BROWSERLESS_PROXY=auto lets the caller tier
   * them. Datacenter costs a third of residential per MB; residential is the
   * fallback for storefronts that block datacenter traffic. */
  proxyTier?: "datacenter" | "residential";
  /** DOM/CSS edit script (a function body) executed on the rendered page just
   * before the screenshot. This is what turns a capture into an HTML "after":
   * the page is re-shot with the edits applied, so every photo and brand asset
   * stays the site's own. */
  editScript?: string;
  /** Read-only script evaluated on the settled page BEFORE any edits; its return
   * value comes back as `probe`. Used to extract the DOM outline the edit
   * author writes selectors against. */
  probeScript?: string;
  /** Overall time budget. The cart flow chains several navigations (product
   * page, permalink add, drawer) and over a residential proxy it can be doing
   * fine at 90s, so carts pass a bigger budget instead of being aborted
   * mid-flow. */
  timeoutMs?: number;
}): Promise<BrowserlessResult> {
  const token = (Deno.env.get("BROWSERLESS_TOKEN") ?? "").trim();
  if (!token) return { ok: false, error: "browserless_token_missing" };
  const base = (Deno.env.get("BROWSERLESS_BASE_URL") ?? "https://production-sfo.browserless.io").replace(/\/$/, "");
  const dim = DIMENSIONS[input.viewport];
  // The /function endpoint only accepts `token` as a query param (launch flags
  // like blockAds/blockConsentModals are for /screenshot and 400 here). Cookie
  // banners + chat widgets are removed in-code by the sweep() in FUNCTION_CODE.
  const qs = new URLSearchParams({ token });
  // Route through Browserless proxies when enabled. Shopify storefronts
  // rate-limit/block datacenter IPs (the 429 "local_rate_limited" page); a
  // residential IP looks like a normal shopper and gets served, but costs 3x
  // per MB. BROWSERLESS_PROXY values:
  //   residential | datacenter - that pool for every capture
  //   auto - the caller picks per capture via proxyTier (datacenter first,
  //          residential for carts and for retries after a block); with no
  //          tier given, auto falls back to residential, the safe pool.
  const envProxy = (Deno.env.get("BROWSERLESS_PROXY") ?? "").trim();
  const proxy = envProxy === "auto" ? (input.proxyTier ?? "residential") : envProxy;
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
  const timer = setTimeout(() => ctrl.abort(), input.timeoutMs ?? (proxy ? 90_000 : 45_000));
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
          secondFold: Boolean(input.secondFold),
          editScript: input.editScript ?? null,
          probeScript: input.probeScript ?? null,
        },
      }),
      signal: ctrl.signal,
    });
    const rawText = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `browserless_http_${res.status}${rawText ? `: ${rawText.slice(0, 140)}` : ""}`, proxyUsed: proxy };
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
      | {
        screenshot?: string;
        screenshot2?: string | null;
        elements?: CapturedElement[];
        error?: string;
        cartCount?: number | null;
        probe?: unknown;
        editReport?: unknown;
      }
      | null;
    // In-page detection (storefront rate-limit / bot-block page) reports a
    // structured error instead of a screenshot.
    if (payload?.error) return { ok: false, error: String(payload.error), proxyUsed: proxy };
    if (!payload?.screenshot) return { ok: false, error: "browserless_no_screenshot", proxyUsed: proxy };
    const png = b64ToBytes(payload.screenshot);
    if (png.byteLength < 5000) return { ok: false, error: "browserless_blank_page", proxyUsed: proxy };
    const elements = Array.isArray(payload.elements) ? payload.elements.slice(0, 90) : [];
    let png2: Uint8Array | null = null;
    if (payload.screenshot2) {
      const b = b64ToBytes(payload.screenshot2);
      if (b.byteLength >= 5000) png2 = b;
    }
    return {
      ok: true,
      png,
      png2,
      elements,
      cartCount: payload.cartCount ?? null,
      proxyUsed: proxy,
      probe: payload.probe ?? null,
      editReport: payload.editReport ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))
      ? "browserless_timeout"
      : (e instanceof Error ? e.message : "browserless_failed");
    return { ok: false, error: msg, proxyUsed: proxy };
  } finally {
    clearTimeout(timer);
  }
}
