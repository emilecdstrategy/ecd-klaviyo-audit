/** Signature images for the agency side of a proposal.
 *
 * A signer either has a saved signature they drew once (stored on their
 * profile) or they don't, in which case we render their name in a handwriting
 * face. The generated one is clearly a typed signature rather than a forgery of
 * anyone's hand, which is the honest thing to produce automatically. */

const WIDTH = 520;
const HEIGHT = 160;

/** Handwriting faces likely to exist on the machines the team uses, ending in
 * the generic `cursive` so something script-like always resolves. */
const SCRIPT_STACK = '"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive';

/** Render a name as a signature PNG data URL. Returns null when there is no
 * canvas (SSR or a locked-down browser), so callers can fall back. */
export function generateSignatureImage(name: string): string | null {
  const text = (name || '').trim();
  if (!text) return null;
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  // Render at 2x for a crisp signature on retina screens and in PDF exports.
  const scale = 2;
  canvas.width = WIDTH * scale;
  canvas.height = HEIGHT * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#1a1a2e';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Shrink to fit rather than overflow: some names are much longer than others.
  let size = 58;
  do {
    ctx.font = `italic ${size}px ${SCRIPT_STACK}`;
    if (ctx.measureText(text).width <= WIDTH - 48) break;
    size -= 2;
  } while (size > 22);

  ctx.fillText(text, WIDTH / 2, HEIGHT / 2);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** The signature to use for a signer: their saved one, else a generated one. */
export function resolveSignatureImage(
  signer: { name?: string | null; signature_image?: string | null },
): string | null {
  const saved = (signer.signature_image ?? '').trim();
  if (saved.startsWith('data:image/png;base64,')) return saved;
  return generateSignatureImage(signer.name ?? '');
}
