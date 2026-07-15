/**
 * Screenshot provider seam. Select the engine with the SCREENSHOT_PROVIDER env
 * var; adding a new provider means adding a class here, nothing else changes.
 *
 *  - 'screenshotone' (recommended): managed screenshot API, reliable on heavy
 *    storefronts. Requires SCREENSHOTONE_ACCESS_KEY.
 *  - 'netlify' (default/fallback): our self-hosted Playwright function. Free but
 *    constrained by Netlify Lambda limits (fails on heavy sites). Requires
 *    SCREENSHOT_FN_URL + SCREENSHOT_FN_SECRET.
 */

export type CaptureInput = { url: string; viewport: "desktop" | "mobile"; interaction?: "cart_drawer" };
export type CaptureResult = { ok: true; png: Uint8Array } | { ok: false; error: string };

export interface ScreenshotProvider {
  capture(input: CaptureInput): Promise<CaptureResult>;
}

const DIMENSIONS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// --- ScreenshotOne (https://screenshotone.com/docs/) -------------------------

class ScreenshotOneProvider implements ScreenshotProvider {
  constructor(private readonly accessKey: string) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    const dim = DIMENSIONS[input.viewport];
    // Drawer captures stay viewport-height (the drawer is a fixed overlay);
    // every other page is full-page top to bottom.
    const fullPage = input.interaction !== "cart_drawer";
    const params = new URLSearchParams({
      access_key: this.accessKey,
      url: input.url,
      format: "png",
      response_type: "by_format",
      viewport_width: String(dim.width),
      viewport_height: String(dim.height),
      device_scale_factor: "1",
      full_page: fullPage ? "true" : "false",
      block_ads: "true",
      block_cookie_banners: "true",
      block_banners_by_heuristics: "true",
      block_trackers: "true",
      block_chats: "true",
      cache: "false",
      wait_until: "networkidle2",
      timeout: "40",
      delay: "2",
    });
    if (fullPage) {
      params.set("full_page_scroll", "true");
      params.set("full_page_max_height", "12000");
    }
    if (input.interaction === "cart_drawer") {
      // Open the slide-cart drawer, but don't fail the capture if no cart
      // trigger matches — just screenshot the page as-is.
      params.set("click", 'a[href*="/cart"]');
      params.set("error_on_click_selector_not_found", "false");
      params.set("delay", "3");
    }
    try {
      const res = await fetch(`https://api.screenshotone.com/take?${params.toString()}`);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, error: `screenshotone_http_${res.status}${txt ? `: ${txt.slice(0, 140)}` : ""}` };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) return { ok: false, error: "screenshotone_empty_response" };
      // A tiny PNG is almost always a store rate-limit / bot-block error page
      // captured as an image (a real storefront screenshot is >100KB). Reject
      // it so the caller retries instead of storing a blank "success".
      if (bytes.byteLength < 15000) return { ok: false, error: "screenshotone_blank_page_rate_limited" };
      return { ok: true, png: bytes };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "screenshotone_request_failed" };
    }
  }
}

// --- Netlify Playwright (self-hosted fallback) -------------------------------

class NetlifyScreenshotProvider implements ScreenshotProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async capture(input: CaptureInput): Promise<CaptureResult> {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/.netlify/functions/screenshot`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-screenshot-key": this.secret,
        },
        body: JSON.stringify({ url: input.url, viewport: input.viewport, interaction: input.interaction }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; png_base64?: string; error?: string } | null;
      if (!res.ok || !body?.ok || !body.png_base64) {
        return { ok: false, error: body?.error ?? `screenshot_http_${res.status}` };
      }
      return { ok: true, png: b64ToBytes(body.png_base64) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "screenshot_request_failed" };
    }
  }
}

export function getScreenshotProvider(): ScreenshotProvider {
  const provider = (Deno.env.get("SCREENSHOT_PROVIDER") ?? "netlify").trim();

  if (provider === "screenshotone") {
    const accessKey = (Deno.env.get("SCREENSHOTONE_ACCESS_KEY") ?? "").trim();
    if (!accessKey) throw new Error("SCREENSHOTONE_ACCESS_KEY is not configured");
    return new ScreenshotOneProvider(accessKey);
  }

  if (provider === "netlify") {
    const baseUrl = (Deno.env.get("SCREENSHOT_FN_URL") ?? "").trim();
    const secret = (Deno.env.get("SCREENSHOT_FN_SECRET") ?? "").trim();
    if (!baseUrl || !secret) throw new Error("SCREENSHOT_FN_URL or SCREENSHOT_FN_SECRET is not configured");
    return new NetlifyScreenshotProvider(baseUrl, secret);
  }

  throw new Error(`Unknown screenshot provider: ${provider}`);
}
