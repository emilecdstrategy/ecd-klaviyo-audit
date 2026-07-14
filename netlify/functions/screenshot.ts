/**
 * Captures a single viewport screenshot of a URL with headless Chromium.
 * Called by the Supabase `web_capture_screenshots` edge function, one
 * invocation per screenshot to stay inside Netlify's 10s sync budget.
 *
 * POST { url, viewport, interaction? } with header x-screenshot-key.
 *  - interaction: 'cart_drawer' loads the page, clicks a cart trigger, and
 *    captures the slide-out drawer (falling back to /cart if none opens).
 * Responds { ok: true, png_base64 } or { ok: false, error }.
 *
 * Real storefronts are heavy, and Netlify's free sync limit is 10s. To fit,
 * we block non-visual/slow resources (fonts, media, analytics, chat widgets)
 * and don't wait for full page load — we settle briefly after the DOM is ready.
 */
import type { Handler } from '@netlify/functions';
import { chromium as playwright } from 'playwright-core';
import type { Page, Route } from 'playwright-core';

// @sparticuz/chromium ships as an ES module; the bundled function is CommonJS,
// so it must be loaded via dynamic import() rather than a static import (which
// esbuild lowers to require() and throws ERR_REQUIRE_ESM at runtime).
async function loadChromium() {
  const mod = await import('@sparticuz/chromium');
  return (mod as { default?: typeof mod }).default ?? mod;
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const NAV_TIMEOUT_MS = 4_000;
const SETTLE_MS = 1_500;
const HARD_BUDGET_MS = 9_400;

// Third-party hosts that don't affect the visual result but slow the page down
// (analytics, tag managers, chat/support widgets, ad/pixel trackers).
const BLOCKED_HOST_FRAGMENTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'doubleclick.net',
  'connect.facebook.net', 'facebook.com/tr', 'static.hotjar.com', 'clarity.ms',
  'tiktok.com', 'snapchat.com', 'pinterest.com', 'bat.bing.com',
  'intercom.io', 'intercomcdn.com', 'widget.intercom', 'drift.com', 'js.driftt.com',
  'zdassets.com', 'zendesk.com', 'tawk.to', 'gorgias.chat', 'klaviyo.com',
  'fullstory.com', 'segment.com', 'cdn.segment', 'mouseflow.com',
];

// Common selectors for the header cart trigger that opens a slide-out drawer.
const CART_TRIGGER_SELECTORS = [
  '#cart-icon-bubble',
  'a[href$="/cart"]',
  'a[href*="/cart"]',
  'button[aria-label*="cart" i]',
  'a[aria-label*="cart" i]',
  '[data-action*="cart" i]',
  '[class*="cart-toggle" i]',
  '[class*="cart-drawer" i] button',
  '[class*="header" i] [class*="cart" i]',
];

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function routeHandler(route: Route) {
  const req = route.request();
  const type = req.resourceType();
  if (type === 'font' || type === 'media') return route.abort();
  const url = req.url();
  if (BLOCKED_HOST_FRAGMENTS.some(frag => url.includes(frag))) return route.abort();
  return route.continue();
}

async function openCartDrawer(page: Page): Promise<void> {
  for (const selector of CART_TRIGGER_SELECTORS) {
    const el = page.locator(selector).first();
    try {
      if ((await el.count()) === 0) continue;
      if (!(await el.isVisible())) continue;
      await el.click({ timeout: 1_200 });
      await page.waitForTimeout(1_200);
      return;
    } catch {
      // try the next selector
    }
  }
  // No drawer trigger worked — fall back to the dedicated cart page.
  try {
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
  } catch {
    // keep whatever is on screen
  }
}

async function capture(
  url: string,
  viewport: keyof typeof VIEWPORTS,
  interaction: string | undefined,
): Promise<string> {
  const chromium = await loadChromium();
  const executablePath = await chromium.executablePath();
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[viewport] });
    await page.route('**/*', routeHandler);
    // 'domcontentloaded' with a short timeout: proceed with whatever rendered
    // rather than waiting for every third-party script to finish.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    if (interaction === 'cart_drawer') {
      await openCartDrawer(page);
    }
    const png = await page.screenshot({ type: 'png', fullPage: false });
    return png.toString('base64');
  } finally {
    await browser.close().catch(() => {});
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const expectedKey = (process.env.SCREENSHOT_KEY ?? '').trim();
  const providedKey = (event.headers['x-screenshot-key'] ?? '').trim();
  if (!expectedKey || providedKey !== expectedKey) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let input: { url?: string; viewport?: string; interaction?: string };
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const url = (input.url ?? '').trim();
  const viewport = input.viewport === 'mobile' ? 'mobile' : 'desktop';
  if (!/^https?:\/\//i.test(url)) return json(400, { ok: false, error: 'invalid_url' });

  try {
    const png = await Promise.race([
      capture(url, viewport, input.interaction),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('capture_timeout')), HARD_BUDGET_MS),
      ),
    ]);
    return json(200, { ok: true, png_base64: png });
  } catch (e) {
    return json(200, { ok: false, error: e instanceof Error ? e.message : 'capture_failed' });
  }
};
