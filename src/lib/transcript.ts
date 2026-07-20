import { supabase } from './supabase';

/** Fetch a meeting transcript (Fireflies) or Google Doc by link, server-side. */
export async function fetchTranscriptFromLink(
  url: string,
): Promise<{ ok: true; content: string; title?: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.functions.invoke('fetch_transcript', { body: { url } });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.json();
        return { ok: false, message: body?.error?.message ?? error.message };
      } catch {
        /* fall through */
      }
    }
    return { ok: false, message: error.message };
  }
  if (data?.ok !== true) return { ok: false, message: data?.error?.message ?? 'Could not fetch that link.' };
  return { ok: true, content: String(data.content ?? ''), title: data.title };
}
