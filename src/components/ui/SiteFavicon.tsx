import { Globe } from 'lucide-react';
import { cn } from '../../lib/utils';
import { faviconUrlFromWebsite } from '../../lib/site-favicon';

const SIZE = {
  sm: { box: 'w-6 h-6', icon: 'w-3 h-3' },
  md: { box: 'w-8 h-8', icon: 'w-4 h-4' },
  lg: { box: 'w-10 h-10 sm:w-11 sm:h-11', icon: 'w-4 h-4' },
} as const;

export default function SiteFavicon({
  url,
  size = 'sm',
  variant = 'default',
  className,
}: {
  url?: string | null;
  size?: keyof typeof SIZE;
  variant?: 'default' | 'onDark';
  className?: string;
}) {
  const src = faviconUrlFromWebsite(url);
  const { box, icon } = SIZE[size];
  const onDark = variant === 'onDark';

  if (!src) {
    return (
      <div
        className={cn(
          box,
          'rounded-full flex items-center justify-center shrink-0',
          onDark ? 'bg-white/15 border border-white/20' : 'bg-gray-100',
          className,
        )}
        aria-hidden
      >
        <Globe className={cn(icon, onDark ? 'text-white/70' : 'text-gray-400')} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={cn(
        box,
        'rounded-full object-cover shrink-0',
        onDark ? 'bg-white border-2 border-white/30 shadow-sm' : 'bg-gray-50 border border-gray-100',
        className,
      )}
      loading="lazy"
    />
  );
}
