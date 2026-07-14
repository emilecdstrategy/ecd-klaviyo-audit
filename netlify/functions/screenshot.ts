/**
 * Captures a single viewport screenshot of a URL with headless Chromium.
 * Called by the Supabase `web_capture_screenshots` edge function, one
 * invocation per screenshot to stay inside Netlify's 10s sync budget.
 *
 * POST { url, viewport: 'desktop' | 'mobile' } with header x-screenshot-key.
 * Responds { ok: true, png_base64 } or { ok: false, error }.
 */
import type { Handler } from '@netlify/functions';
import { chromium as playwright } from 'playwright-core';

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

const NAV_TIMEOUT_MS = 6_000;
const SETTLE_MS = 1_000;
const HARD_BUDGET_MS = 8_800;

function json(statusCode: number, body: unknown) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function capture(url: string, viewport: keyof typeof VIEWPORTS): Promise<string> {
  const chromium = await loadChromium();
  const executablePath = await chromium.executablePath();
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: VIEWPORTS[viewport] });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {
      // domcontentloaded timeout on heavy sites: capture whatever rendered.
    });
    await page.waitForTimeout(SETTLE_MS);
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

  let input: { url?: string; viewport?: string };
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
      capture(url, viewport),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('capture_timeout')), HARD_BUDGET_MS),
      ),
    ]);
    return json(200, { ok: true, png_base64: png });
  } catch (e) {
    return json(200, { ok: false, error: e instanceof Error ? e.message : 'capture_failed' });
  }
};
