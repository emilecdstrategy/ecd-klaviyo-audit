import { normalizeStorefrontUrl } from "./competing-sms-detect.ts";

const FETCH_TIMEOUT_MS = 14_000;
const MAX_HTML_BYTES = 600_000;

export type StorefrontFetchResult = {
  website_url: string | null;
  fetch_ok: boolean;
  status: number | null;
  error: string | null;
  html: string;
};

export async function fetchStorefrontHtml(
  websiteUrl: string | null | undefined,
): Promise<StorefrontFetchResult> {
  const origin = normalizeStorefrontUrl(websiteUrl);
  if (!origin) {
    return { website_url: null, fetch_ok: false, status: null, error: "invalid_url", html: "" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(origin, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "ECD-Klaviyo-Audit/1.0 (+https://audit.ecdigitalstrategy.com)",
      },
    });
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("utf-8", { fatal: false }).decode(
      buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf,
    );
    return {
      website_url: origin,
      fetch_ok: res.ok,
      status: res.status,
      error: res.ok ? null : `http_${res.status}`,
      html,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return {
      website_url: origin,
      fetch_ok: false,
      status: null,
      error: msg,
      html: "",
    };
  } finally {
    clearTimeout(timer);
  }
}
