/**
 * Screenshot provider seam. The default provider calls our Netlify Playwright
 * function; a paid screenshot API can be swapped in here later without
 * touching the orchestrator (set SCREENSHOT_PROVIDER + implement a provider).
 */

export type CaptureInput = { url: string; viewport: "desktop" | "mobile" };
export type CaptureResult = { ok: true; png: Uint8Array } | { ok: false; error: string };

export interface ScreenshotProvider {
  capture(input: CaptureInput): Promise<CaptureResult>;
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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
        body: JSON.stringify({ url: input.url, viewport: input.viewport }),
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
  if (provider !== "netlify") {
    throw new Error(`Unknown screenshot provider: ${provider}`);
  }
  const baseUrl = (Deno.env.get("SCREENSHOT_FN_URL") ?? "").trim();
  const secret = (Deno.env.get("SCREENSHOT_FN_SECRET") ?? "").trim();
  if (!baseUrl || !secret) throw new Error("SCREENSHOT_FN_URL or SCREENSHOT_FN_SECRET is not configured");
  return new NetlifyScreenshotProvider(baseUrl, secret);
}
