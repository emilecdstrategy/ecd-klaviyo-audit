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
 * Netlify Lambda constraints we work around here:
 *  - /tmp is only 512MB and is REUSED across warm invocations. Playwright
 *    leaks artifact dirs there, so we sweep stale ones before each launch to
 *    avoid ENOSPC. We also bound every step with a real Playwright timeout and
 *    always close the browser (no Promise.race, which abandoned in-flight
 *    launches and leaked zombie chromium processes).
 *  - 10s sync limit: block non-visual/slow resources and don't wait for full
 *    page load.
 */
import type { Handler } from '@netlify/functions';
import { chromium as playwright } from 'playwright-core';
import type { Browser, Page, Route } from 'playwright-core';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadChromium() {
  const mod = await import('@sparticuz/chromium');
  return (mod as { default?: typeof mod }).default ?? mod;
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const LAUNCH_TIMEOUT_MS = 6_000;
const NAV_TIMEOUT_MS = 4_000;
const SETTLE_MS = 1_200;
const SCREENSHOT_TIMEOUT_MS = 4_000;

const BLOCKED_HOST_FRAGMENTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'doubleclick.net',
  'connect.facebook.net', 'facebook.com/tr', 'static.hotjar.com', 'clarity.ms',
  'tiktok.com', 'snapchat.com', 'pinterest.com', 'bat.bing.com',
  'intercom.io', 'intercomcdn.com', 'widget.intercom', 'drift.com', 'js.driftt.com',
  'zdassets.com', 'zendesk.com', 'tawk.to', 'gorgias.chat', 'klaviyo.com',
  'fullstory.com', 'segment.com', 'cdn.segment', 'mouseflow.com',
];

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

/** Remove leaked Playwright temp dirs from previous (warm) invocations so /tmp
 *  doesn't fill up. Never touches /tmp/chromium (the extracted binary). */
function sweepTmp() {
  try {
    const dir = tmpdir();
    for (const name of readdirSync(dir)) {
      if (name.startsWith('playwright-artifacts-') || name.startsWith('playwright_')) {
        try { rmSync(join(dir, name), { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
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
  (chromium as { setGraphicsMode?: boolean }).setGraphicsMode = false;
  const executablePath = await chromium.executablePath();

  let browser: Browser | undefined;
  try {
    browser = await playwright.launch({
      args: chromium.args,
      executablePath,
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
    });
    const page = await browser.newPage({ viewport: VIEWPORTS[viewport] });
    await page.route('**/*', routeHandler);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    if (interaction === 'cart_drawer') {
      await openCartDrawer(page);
    }
    const png = await page.screenshot({ type: 'png', fullPage: false, timeout: SCREENSHOT_TIMEOUT_MS });
    return Buffer.from(png).toString('base64');
  } finally {
    // Always close so the artifact dir + chromium process are cleaned up.
    await browser?.close().catch(() => {});
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

  sweepTmp();
  try {
    const png = await capture(url, viewport, input.interaction);
    return json(200, { ok: true, png_base64: png });
  } catch (e) {
    return json(200, { ok: false, error: e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : 'capture_failed' });
  }
};
