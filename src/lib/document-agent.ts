import { supabase } from './supabase';
import { createDocument, updateDocument, recordDocumentEvent } from './documents-db';
import { publicProposalOrigin } from './public-origin';
import type { Document, ProposalAgentAttachment } from './types';

// ---------------------------------------------------------------------------
// Payload types (mirror supabase/functions/document_agent)

export type DocAgentQuestion = {
  question: string;
  options: Array<{ label: string; value: string }>;
  allow_other: boolean;
  multi_select?: boolean;
};

export type DocDraftPayload = { title: string; content: string; summary: string };
export type DocEditPayload = { content: string; summary: string };

export type DocAgentResponse = {
  ok: true;
  conversation_id: string;
  assistant_message_id: string;
  assistant_text: string;
  question?: DocAgentQuestion;
  draft?: DocDraftPayload;
  edits?: DocEditPayload;
};

export type DocumentSnapshot = { id: string; title: string; content: string };

export class DocAgentError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Remove em/en dashes; belt and braces (the edge function also sanitizes). */
export function sanitizeCopy(input: string): string {
  if (!input) return input;
  return input
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/[–—]/g, ', ');
}

const SNAPSHOT_CONTENT_CAP = 12000;

export function buildDocumentSnapshot(document: Document): DocumentSnapshot {
  return {
    id: document.id,
    title: document.title,
    content:
      document.content.length > SNAPSHOT_CONTENT_CAP
        ? `${document.content.slice(0, SNAPSHOT_CONTENT_CAP)}\n[truncated]`
        : document.content,
  };
}

export const MAX_DOC_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export async function uploadDocumentAgentFile(
  file: File,
  conversationId: string | null,
): Promise<ProposalAgentAttachment> {
  if (file.type !== 'application/pdf') throw new Error('Only PDF files are supported right now.');
  if (file.size > MAX_DOC_ATTACHMENT_BYTES) throw new Error('That PDF is too large. Please keep it under 20 MB.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'document.pdf';
  const path = `document-agent/${conversationId ?? 'new'}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from('audit-assets')
    .upload(path, file, { upsert: false, contentType: 'application/pdf' });
  if (error) throw error;
  const { data } = supabase.storage.from('audit-assets').getPublicUrl(path);
  return { url: data.publicUrl, name: file.name, media_type: 'application/pdf', size: file.size };
}

export async function sendDocAgentMessage(input: {
  conversation_id?: string | null;
  document_id?: string | null;
  message: string;
  attachments?: ProposalAgentAttachment[];
  snapshot?: DocumentSnapshot | null;
}): Promise<DocAgentResponse> {
  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await supabase.functions.invoke<DocAgentResponse | { ok: false; error: { code: string; message: string } }>(
      'document_agent',
      {
        body: {
          conversation_id: input.conversation_id ?? undefined,
          document_id: input.document_id ?? undefined,
          message: input.message,
          attachments: input.attachments?.length ? input.attachments : undefined,
          snapshot: input.snapshot ?? undefined,
        },
      },
    );
    if (error) {
      lastErr = new DocAgentError(error.message || 'Request failed', 'request_failed');
      const retryable = /timeout|504|546|502|503|Failed to send/i.test(error.message ?? '');
      if (retryable && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1500 + attempt * 1000));
        continue;
      }
      throw lastErr;
    }
    if (!data || data.ok !== true) {
      const err = (data as { error?: { code?: string; message?: string } })?.error;
      throw new DocAgentError(err?.message ?? 'The assistant request failed', err?.code ?? 'request_failed');
    }
    return data;
  }
  throw lastErr instanceof Error ? lastErr : new DocAgentError('Request failed', 'request_failed');
}

// ---------------------------------------------------------------------------
// Apply helpers

/** origin for the (unused here) public link parity; kept for symmetry. */
export const docPublicOrigin = publicProposalOrigin;

export async function applyDraftAsNewDocument(draft: DocDraftPayload): Promise<Document> {
  return createDocument(
    { title: sanitizeCopy(draft.title), content: sanitizeCopy(draft.content) },
    { aiAssisted: true },
  );
}

export async function applyDocumentEdits(document: Document, edits: DocEditPayload): Promise<Document> {
  const updated = await updateDocument(document.id, { content: sanitizeCopy(edits.content) });
  await recordDocumentEvent(document.id, 'updated', { via: 'ai_assistant' }).catch(() => {});
  return updated;
}
