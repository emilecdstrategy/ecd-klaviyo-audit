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

/** Every signature is drawn in the same box, so a short name and a long one
 * occupy the same space in the acceptance block and line up with each other. */
const WIDTH = 360;
const PADDING = 16;

/** Render a name as a signature SVG data URL, or null when there is no name.
 *
 * textLength pins the text to an exact width, so it cannot spill past the edge
 * of the box the way a guessed width does: script faces vary enough between
 * machines that no character-count estimate holds. lengthAdjust spreads the
 * difference across spacing and glyphs, which is what keeps a short name from
 * looking stretched. */
export function generateSignatureImage(name: string): string | null {
  const text = (name || '').trim();
  if (!text) return null;
  // Short names should not be blown up to the full width; long ones are reined
  // in to it. The cap is what guarantees the text always fits.
  const natural = Math.round(text.length * FONT_SIZE * 0.52);
  const textWidth = Math.min(WIDTH - PADDING * 2, Math.max(120, natural));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<text x="${WIDTH / 2}" y="${HEIGHT / 2}" dominant-baseline="middle" text-anchor="middle" ` +
    `textLength="${textWidth}" lengthAdjust="spacingAndGlyphs" ` +
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
