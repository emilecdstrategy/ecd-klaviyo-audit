import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebFindingVisual } from '../../../lib/web-report-details';

/**
 * A finding's own pictures: what is wrong today (a screenshot) and the proposed
 * fix (a mock-up), side by side when both exist.
 *
 * Screenshots are scaled to fit, never cropped by the layout: some are whole
 * phone screens whose problem is at the bottom (a cookie banner over Checkout),
 * and anchoring a crop to the top hid exactly that. Click opens the full image.
 *
 * The mock-up is HTML written for the client's brand, so it is shown in a frame
 * with scripts, forms, popups and navigation all off. allow-same-origin is kept
 * only so this page can read the frame's height and size it to its content;
 * with no scripts allowed inside, nothing in the frame can use that origin.
 */
export default function WebFindingVisuals({
  visual,
  size = 'small',
}: {
  visual: WebFindingVisual;
  /** 'large' when the pictures have half a row to themselves. */
  size?: 'small' | 'large';
}) {
  const hasImage = Boolean(visual.image_url);
  const hasMockup = Boolean(visual.mockup_html);
  const phone = visual.viewport === 'mobile';
  const maxH = size === 'large' ? 'max-h-[440px]' : 'max-h-64';
  return (
    <div className={`grid items-start gap-4 ${hasImage && hasMockup ? 'sm:grid-cols-2' : ''}`}>
      {hasImage && (
        <figure className={`min-w-0 ${phone && !hasMockup ? 'mx-auto w-full max-w-[280px]' : ''}`}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today</p>
          <a
            href={visual.image_url as string}
            target="_blank"
            rel="noopener noreferrer"
            title="Open full size"
            className="flex justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 hover:border-gray-300"
          >
            <img
              src={visual.image_url as string}
              alt={visual.caption ?? ''}
              loading="lazy"
              className={`block h-auto w-auto max-w-full ${maxH} object-contain`}
            />
          </a>
          {visual.caption && <figcaption className="mt-1.5 text-xs leading-snug text-gray-500">{visual.caption}</figcaption>}
        </figure>
      )}
      {hasMockup && (
        <figure className="min-w-0">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-primary">Proposed</p>
          <MockupFrame html={visual.mockup_html as string} />
          {visual.mockup_caption && <figcaption className="mt-1.5 text-xs leading-snug text-gray-500">{visual.mockup_caption}</figcaption>}
        </figure>
      )}
    </div>
  );
}

function MockupFrame({ html }: { html: string }) {
  const [height, setHeight] = useState(160);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  // Sized to its content, and kept sized: product photos and the web font
  // arrive after load and change the height, which left the first version
  // scrolling inside a frame measured too early.
  const measure = useCallback((frame: HTMLIFrameElement | null) => {
    const doc = frame?.contentDocument;
    if (!doc?.body) return;
    const fit = () => setHeight(Math.ceil(doc.body.scrollHeight) + 2);
    fit();
    observer.current?.disconnect();
    observer.current = new ResizeObserver(fit);
    observer.current.observe(doc.body);
  }, []);
  return (
    <iframe
      title="Proposed fix"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${html}</body></html>`}
      onLoad={(e) => measure(e.currentTarget)}
      scrolling="no"
      className="block w-full overflow-hidden rounded-lg border-0"
      style={{ height }}
    />
  );
}
