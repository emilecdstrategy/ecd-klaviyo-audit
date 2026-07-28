/** Signature images for the agency side of a proposal or document.
 *
 * A signer either has a saved signature they drew once (a PNG on their profile)
 * or they don't, in which case their name is rendered in a handwriting face.
 * The generated one is an SVG: a few hundred bytes rather than tens of
 * kilobytes of canvas PNG, crisp at any size, and identical whether it is
 * produced in the browser or in SQL during a backfill. It is plainly a typed
 * signature rather than an imitation of anyone's hand, which is the honest
 * thing to generate automatically. */

const SCRIPT_STACK = "Segoe Script, Brush Script MT, Snell Roundhand, Apple Chancery, cursive";
const FONT_SIZE = 34;
const HEIGHT = 52;

/** Base64 that survives non-ASCII names (btoa alone throws on them). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a name as a signature SVG data URL, or null when there is no name. */
export function generateSignatureImage(name: string): string | null {
  const text = (name || '').trim();
  if (!text) return null;
  // Script faces run about half the font size per character; the padding keeps
  // descenders and flourishes inside the box.
  const width = Math.max(180, Math.round(text.length * FONT_SIZE * 0.52) + 40);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">` +
    `<text x="${width / 2}" y="${HEIGHT / 2}" dominant-baseline="middle" text-anchor="middle" ` +
    `font-family="${SCRIPT_STACK}" font-style="italic" font-size="${FONT_SIZE}" fill="#1a1a2e">` +
    `${escapeXml(text)}</text></svg>`;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

/** True for the image formats a signature may be stored in. */
export function isSignatureImage(value: string): boolean {
  return value.startsWith('data:image/png;base64,') || value.startsWith('data:image/svg+xml;base64,');
}

/** The signature to use for a signer: their saved drawing, else a generated one. */
export function resolveSignatureImage(
  signer: { name?: string | null; signature_image?: string | null },
): string | null {
  const saved = (signer.signature_image ?? '').trim();
  if (isSignatureImage(saved)) return saved;
  return generateSignatureImage(signer.name ?? '');
}
