import { supabase } from './supabase';
import type { ProposalAgentAttachment } from './types';

/** Image attachments for the AI assistant chats (screenshots, mostly).
 *
 * Every image is downscaled client-side before upload: a 4K screenshot carries
 * no more signal for the model than a 1600px one, but costs real tokens and
 * storage. Uploads land in the public audit-assets bucket, same as the PDF
 * attachments, so the LLM adapter can keep passing plain URLs. */

export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_IMAGES_PER_MESSAGE = 4;
const MAX_EDGE_PX = 1600;

export function isImageFile(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(file.type);
}

/** Pull pasted image files out of a clipboard event, if any. */
export function imagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const dt = 'clipboardData' in e ? e.clipboardData : null;
  if (!dt) return [];
  const out: File[] = [];
  for (const file of Array.from(dt.files ?? [])) {
    if (isImageFile(file)) out.push(file);
  }
  if (out.length === 0) {
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && isImageFile(file)) out.push(file);
      }
    }
  }
  return out;
}

/** Downscale to MAX_EDGE_PX on the long edge. Returns the original file when it
 * is already small enough or when the canvas path fails (e.g. exotic formats):
 * a full-size upload is a worse outcome than a failed one. GIFs are passed
 * through untouched so an animation is not flattened to its first frame. */
async function downscale(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const long = Math.max(bitmap.width, bitmap.height);
      if (long <= MAX_EDGE_PX) return file;
      const scale = MAX_EDGE_PX / long;
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      // PNG keeps screenshots' text crisp; JPEG stays JPEG to avoid inflating photos.
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, type === 'image/jpeg' ? 0.9 : undefined),
      );
      return blob ?? file;
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}

/** Validate, downscale, and upload one chat image. `prefix` namespaces the
 * storage path per assistant (e.g. "web-audit-agent/<auditId>"). */
export async function uploadChatImage(
  file: File,
  prefix: string,
): Promise<ProposalAgentAttachment> {
  if (!isImageFile(file)) throw new Error('Only PNG, JPG, WebP, or GIF images can be attached');
  if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('Images can be at most 8 MB');
  const blob = await downscale(file);
  const type = blob.type || file.type;
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'png';
  const safeName = (file.name || `screenshot.${ext}`).replace(/[^\w.\-]+/g, '_').slice(0, 80);
  const path = `${prefix}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from('audit-assets')
    .upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  const { data } = supabase.storage.from('audit-assets').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Image upload failed: no public URL');
  return { url: data.publicUrl, name: file.name || safeName, media_type: type, size: blob.size };
}

export function isImageAttachment(att: { media_type?: string | null }): boolean {
  return /^image\//i.test(att.media_type ?? '');
}
