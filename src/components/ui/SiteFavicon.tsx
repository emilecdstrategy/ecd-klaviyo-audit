import { Globe } from 'lucide-react';
import { faviconUrlFromWebsite } from '../../lib/site-favicon';

export default function SiteFavicon({
  url,
  size = 'sm',
}: {
  url?: string | null;
  size?: 'sm' | 'md';
}) {
  const src = faviconUrlFromWebsite(url);
  const sizeClasses = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  if (!src) {
    return (
      <div
        className={`${sizeClasses} rounded-full bg-gray-100 flex items-center justify-center shrink-0`}
        aria-hidden
      >
        <Globe className={`${iconSize} text-gray-400`} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`${sizeClasses} rounded-full object-cover bg-gray-50 border border-gray-100 shrink-0`}
      loading="lazy"
    />
  );
}
