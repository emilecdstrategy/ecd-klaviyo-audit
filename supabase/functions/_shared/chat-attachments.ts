import type { LlmMessage } from "./llm-adapter.ts";

// Attachments on assistant chat messages. PDFs ride to the model as document
// blocks (user_docs) and images as image blocks (user_images); pushing an image
// through the document path silently breaks, because the adapter defaults the
// media type to application/pdf.

export type ChatAttachment = { url: string; name: string; media_type: string; size?: number };

export function isImageAttachment(a: { media_type?: string | null } | null | undefined): boolean {
  return /^image\//i.test(a?.media_type ?? "");
}

/** Build the LlmMessage turn(s) for one user message with attachments. The
 * user's own text always rides on the LAST message so it lands next to the
 * model's reply position; consecutive user turns are fine (the history builder
 * already emits them for fetched documents). */
export function attachmentTurn(text: string, atts: ChatAttachment[], fallbackText: string): LlmMessage[] {
  const clean = (atts ?? []).filter((a) => a?.url);
  const docs = clean.filter((a) => !isImageAttachment(a));
  const images = clean.filter((a) => isImageAttachment(a));
  const finalText = text || fallbackText;
  const out: LlmMessage[] = [];
  if (docs.length > 0) {
    out.push({
      role: "user_docs",
      text: images.length > 0 ? "" : finalText,
      documents: docs.map((a) => ({ url: a.url, media_type: a.media_type || "application/pdf", name: a.name })),
    });
  }
  if (images.length > 0) {
    out.push({
      role: "user_images",
      text: finalText,
      images: images.map((a) => ({ url: a.url, label: a.name ? `Attached image: ${a.name}` : undefined })),
    });
  }
  if (out.length === 0) out.push({ role: "user", text });
  return out;
}
