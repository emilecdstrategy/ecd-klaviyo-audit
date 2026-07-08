const FETCH_TIMEOUT_MS = 15_000;
const MAX_DOC_BYTES = 300_000;

export type GoogleDocFetchResult =
  | { ok: true; doc_id: string; format: "md" | "txt"; content: string; truncated: boolean }
  | { ok: false; error_code: "invalid_url" | "doc_private" | "doc_not_found" | "doc_too_large" | "fetch_failed"; message: string };

export function extractGoogleDocId(url: string): string | null {
  const m = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url ?? "");
  return m ? m[1] : null;
}

function looksLikeHtmlLoginPage(contentType: string, body: string): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const head = body.slice(0, 500);
  return /^\s*<!doctype html/i.test(head) || /accounts\.google\.com|ServiceLogin/i.test(head);
}

async function fetchExport(docId: string, format: "md" | "txt") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://docs.google.com/document/d/${docId}/export?format=${format}`,
      {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "ECD-Proposals/1.0 (+https://proposal.ecdigitalstrategy.com)",
        },
      },
    );
    const buf = await res.arrayBuffer();
    const tooLarge = buf.byteLength > MAX_DOC_BYTES;
    const body = new TextDecoder("utf-8", { fatal: false }).decode(
      tooLarge ? buf.slice(0, MAX_DOC_BYTES) : buf,
    );
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type") ?? "",
      finalUrl: res.url ?? "",
      body,
      tooLarge,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a link-shared Google Doc via its export endpoint. The doc must be
 * set to "Anyone with the link can view"; private docs return doc_private
 * so the agent can ask the user to fix sharing or paste the text instead.
 */
export async function fetchGoogleDoc(url: string): Promise<GoogleDocFetchResult> {
  const docId = extractGoogleDocId(url);
  if (!docId) {
    return { ok: false, error_code: "invalid_url", message: "Not a Google Docs document link" };
  }

  for (const format of ["md", "txt"] as const) {
    let res;
    try {
      res = await fetchExport(docId, format);
    } catch (e) {
      return {
        ok: false,
        error_code: "fetch_failed",
        message: e instanceof Error ? e.message : "fetch_failed",
      };
    }

    if (res.status === 404) {
      return { ok: false, error_code: "doc_not_found", message: "Document not found" };
    }
    const redirectedToLogin = /accounts\.google\.com/i.test(res.finalUrl);
    if (res.status === 401 || res.status === 403 || redirectedToLogin) {
      return {
        ok: false,
        error_code: "doc_private",
        message: "Document is not link-shared. Set it to 'Anyone with the link can view' or paste the text.",
      };
    }
    if (res.ok) {
      if (looksLikeHtmlLoginPage(res.contentType, res.body)) {
        return {
          ok: false,
          error_code: "doc_private",
          message: "Document is not link-shared. Set it to 'Anyone with the link can view' or paste the text.",
        };
      }
      return { ok: true, doc_id: docId, format, content: res.body, truncated: res.tooLarge };
    }
    // Non-ok, non-auth status: try the next format before giving up.
  }
  return { ok: false, error_code: "fetch_failed", message: "Google Docs export request failed" };
}
