import { getSecret } from "./app-secrets.ts";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT_CHARS = 200_000;
const FIREFLIES_GRAPHQL_URL = "https://api.fireflies.ai/graphql";

export type FirefliesFetchResult =
  | { ok: true; transcript_id: string; title: string; content: string; truncated: boolean }
  | {
      ok: false;
      error_code: "invalid_url" | "not_configured" | "not_authorized" | "not_found" | "fetch_failed";
      message: string;
    };

/**
 * Pull the transcript id out of a Fireflies link. View URLs look like
 * https://app.fireflies.ai/view/Some-Meeting-Title::01ABCDEF..., where the id
 * follows the last "::". Some links omit the title and are just
 * https://app.fireflies.ai/view/01ABCDEF... — handle both, and accept a bare id.
 */
export function extractFirefliesTranscriptId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // "title::id" form (with or without a surrounding URL).
  const doubleColon = raw.split("::");
  if (doubleColon.length > 1) {
    const tail = doubleColon[doubleColon.length - 1];
    const id = /^([A-Za-z0-9_-]{6,})/.exec(tail)?.[1];
    if (id) return id;
  }

  // /view/<id> form.
  const viewMatch = /fireflies\.ai\/view\/([^/?#]+)/i.exec(raw);
  if (viewMatch) {
    const seg = viewMatch[1];
    const afterColon = seg.includes("::") ? seg.split("::").pop()! : seg;
    const id = /^([A-Za-z0-9_-]{6,})/.exec(afterColon)?.[1];
    if (id) return id;
  }

  // Bare id pasted on its own (no URL, no title).
  if (!/[/:.\s]/.test(raw) && /^[A-Za-z0-9_-]{6,}$/.test(raw)) return raw;

  return null;
}

const TRANSCRIPT_QUERY = `query Transcript($id: String!) {
  transcript(id: $id) {
    title
    dateString
    duration
    participants
    summary { overview action_items keywords }
    sentences { speaker_name text }
  }
}`;

type FirefliesSentence = { speaker_name?: string | null; text?: string | null };
type FirefliesTranscript = {
  title?: string | null;
  dateString?: string | null;
  duration?: number | null;
  participants?: string[] | null;
  summary?: { overview?: string | null; action_items?: string | null; keywords?: string[] | null } | null;
  sentences?: FirefliesSentence[] | null;
};

function formatTranscript(t: FirefliesTranscript): string {
  const lines: string[] = ["Fireflies meeting transcript"];
  if (t.title) lines.push(`Title: ${t.title}`);
  if (t.dateString) lines.push(`Date: ${t.dateString}`);
  if (typeof t.duration === "number" && t.duration > 0) lines.push(`Duration: ${Math.round(t.duration)} min`);
  if (Array.isArray(t.participants) && t.participants.length) {
    lines.push(`Participants: ${t.participants.filter(Boolean).join(", ")}`);
  }

  const overview = t.summary?.overview?.trim();
  if (overview) lines.push("", "Summary:", overview);

  const actionItems = t.summary?.action_items?.trim();
  if (actionItems) lines.push("", "Action items:", actionItems);

  const keywords = t.summary?.keywords?.filter(Boolean);
  if (keywords && keywords.length) lines.push("", `Keywords: ${keywords.join(", ")}`);

  const sentences = Array.isArray(t.sentences) ? t.sentences : [];
  if (sentences.length) {
    lines.push("", "Transcript:");
    let lastSpeaker = "";
    for (const s of sentences) {
      const text = (s.text ?? "").trim();
      if (!text) continue;
      const speaker = (s.speaker_name ?? "").trim() || "Speaker";
      if (speaker !== lastSpeaker) {
        lines.push(`${speaker}: ${text}`);
        lastSpeaker = speaker;
      } else {
        lines.push(text);
      }
    }
  }

  return lines.join("\n");
}

function classifyErrors(status: number, errors: Array<{ message?: string; code?: string; extensions?: { code?: string } }>): FirefliesFetchResult | null {
  const blob = errors
    .map(e => `${e.code ?? ""} ${e.extensions?.code ?? ""} ${e.message ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (status === 401 || status === 403 || /unauthor|invalid.*(api.?key|token|authorization)|forbidden/.test(blob)) {
    return {
      ok: false,
      error_code: "not_authorized",
      message: "Fireflies rejected the API key. Check the Fireflies key in Settings, or paste the transcript text.",
    };
  }
  if (/not.?found|object_not_found|no.*transcript/.test(blob)) {
    return { ok: false, error_code: "not_found", message: "That Fireflies transcript could not be found." };
  }
  return null;
}

/**
 * Fetch a Fireflies meeting transcript via the Fireflies GraphQL API. Requires a
 * workspace API key stored as the `fireflies_api_key` secret (Fireflies dashboard,
 * Settings, Developer/API). Transcripts are private, so there is no anonymous
 * fallback: without a valid key this returns not_authorized.
 */
export async function fetchFirefliesTranscript(url: string): Promise<FirefliesFetchResult> {
  const transcriptId = extractFirefliesTranscriptId(url);
  if (!transcriptId) {
    return { ok: false, error_code: "invalid_url", message: "Not a Fireflies transcript link" };
  }

  let apiKey = "";
  try {
    apiKey = await getSecret("fireflies_api_key");
  } catch {
    return {
      ok: false,
      error_code: "not_configured",
      message: "No Fireflies API key is configured. Add one under Settings, or paste the transcript text.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      error_code: "not_configured",
      message: "No Fireflies API key is configured. Add one under Settings, or paste the transcript text.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FIREFLIES_GRAPHQL_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: TRANSCRIPT_QUERY, variables: { id: transcriptId } }),
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error_code: "fetch_failed", message: e instanceof Error ? e.message : "fetch_failed" };
  }
  clearTimeout(timer);

  let payload: { data?: { transcript?: FirefliesTranscript | null }; errors?: Array<{ message?: string; code?: string; extensions?: { code?: string } }> };
  try {
    payload = await res.json();
  } catch {
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error_code: "not_authorized",
        message: "Fireflies rejected the API key. Check the Fireflies key in Settings, or paste the transcript text.",
      };
    }
    return { ok: false, error_code: "fetch_failed", message: "Fireflies returned an unreadable response." };
  }

  const transcript = payload.data?.transcript ?? null;
  if (payload.errors?.length && !transcript) {
    const classified = classifyErrors(res.status, payload.errors);
    if (classified) return classified;
    return { ok: false, error_code: "fetch_failed", message: payload.errors[0]?.message ?? "Fireflies request failed" };
  }
  if (!res.ok && !transcript) {
    const classified = classifyErrors(res.status, payload.errors ?? []);
    if (classified) return classified;
    return { ok: false, error_code: "fetch_failed", message: `Fireflies request failed (${res.status})` };
  }
  if (!transcript) {
    return { ok: false, error_code: "not_found", message: "That Fireflies transcript could not be found." };
  }

  const full = formatTranscript(transcript);
  const truncated = full.length > MAX_TRANSCRIPT_CHARS;
  return {
    ok: true,
    transcript_id: transcriptId,
    title: transcript.title ?? "",
    content: truncated ? full.slice(0, MAX_TRANSCRIPT_CHARS) : full,
    truncated,
  };
}
