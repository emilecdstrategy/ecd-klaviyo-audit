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
  | { ok: true; png: Uint8Array; elements: CapturedElement[] }
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
  const { url, width, height, fullPage, withElements, clickSelector } = context;
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

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
  await page.evaluate(sweep).catch(() => {});

  if (clickSelector) {
    try {
      await page.click(clickSelector);
      await new Promise((r) => setTimeout(r, 2500));
    } catch (e) {}
  }

  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(sweep).catch(() => {});

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
        let text = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 60);
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

  const screenshot = await page.screenshot({ encoding: "base64", fullPage: !!fullPage, captureBeyondViewport: !!fullPage });
  return { data: { screenshot, elements }, type: "application/json" };
};
`;

export async function captureWithBrowserless(input: {
  url: string;
  viewport: "desktop" | "mobile";
  fullPage: boolean;
  withElements: boolean;
  clickSelector?: string;
}): Promise<BrowserlessResult> {
  const token = (Deno.env.get("BROWSERLESS_TOKEN") ?? "").trim();
  if (!token) return { ok: false, error: "browserless_token_missing" };
  const base = (Deno.env.get("BROWSERLESS_BASE_URL") ?? "https://production-sfo.browserless.io").replace(/\/$/, "");
  const dim = DIMENSIONS[input.viewport];
  const qs = new URLSearchParams({ token, blockAds: "true", blockConsentModals: "true" });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 75_000);
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
          clickSelector: input.clickSelector ?? null,
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `browserless_http_${res.status}${txt ? `: ${txt.slice(0, 140)}` : ""}` };
    }
    const body = (await res.json().catch(() => null)) as
      | { screenshot?: string; elements?: CapturedElement[] }
      | null;
    if (!body?.screenshot) return { ok: false, error: "browserless_no_screenshot" };
    const png = b64ToBytes(body.screenshot);
    if (png.byteLength < 5000) return { ok: false, error: "browserless_blank_page" };
    const elements = Array.isArray(body.elements) ? body.elements.slice(0, 60) : [];
    return { ok: true, png, elements };
  } catch (e) {
    const msg = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))
      ? "browserless_timeout"
      : (e instanceof Error ? e.message : "browserless_failed");
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
