import type { WebHighlight } from '../../../lib/web-report-details';

/**
 * A zoomed crop of a screenshot region, done purely in CSS (no server crop).
 * The crop box is a % rect {x,y,w,h} of the source image.
 */
export default function WebCropCard({
  index,
  imageUrl,
  highlight,
}: {
  index: number;
  imageUrl: string;
  highlight: WebHighlight;
}) {
  const w = Math.min(Math.max(highlight.w, 1), 100);
  const h = Math.min(Math.max(highlight.h, 1), 100);
  // background-size: the image is scaled so the crop box fills the container width.
  const bgSize = `${(100 / w) * 100}% auto`;
  // background-position: map the crop's top-left onto the 0-100% positioning scale.
  const posX = w >= 100 ? 0 : (highlight.x / (100 - w)) * 100;
  const posY = h >= 100 ? 0 : (highlight.y / (100 - h)) * 100;
  // aspect ratio of the crop relative to the container width.
  const paddingTop = `${(h / w) * 100}%`;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="relative w-full" style={{ paddingTop }}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: bgSize,
            backgroundPosition: `${posX}% ${posY}%`,
            backgroundRepeat: 'no-repeat',
          }}
        />
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-xs font-bold text-white shadow ring-2 ring-white">
          {index}
        </span>
      </div>
      {highlight.label && (
        <p className="border-t border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">{highlight.label}</p>
      )}
    </div>
  );
}
