import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '../../lib/utils';
import { faviconFallbackUrlFromWebsite, faviconUrlFromWebsite } from '../../lib/site-favicon';

const SIZE = {
  sm: { box: 'w-6 h-6', icon: 'w-3 h-3' },
  md: { box: 'w-9 h-9', icon: 'w-4 h-4' },
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
  const [imgStage, setImgStage] = useState<'primary' | 'fallback' | 'failed'>('primary');
  const primarySrc = faviconUrlFromWebsite(url);
  const fallbackSrc = faviconFallbackUrlFromWebsite(url);
  const { box, icon } = SIZE[size];
  const onDark = variant === 'onDark';

  useEffect(() => {
    setImgStage('primary');
  }, [url]);

  const src =
    imgStage === 'primary' ? primarySrc
    : imgStage === 'fallback' ? fallbackSrc
    : null;

  if (!src || imgStage === 'failed') {
    return (
      <div
        className={cn(
          box,
          'rounded-full flex items-center justify-center shrink-0',
          onDark ? 'bg-white/15 border border-white/20' : 'bg-gray-100 border border-gray-200/80',
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
      key={src}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => {
        if (imgStage === 'primary' && fallbackSrc && fallbackSrc !== primarySrc) {
          setImgStage('fallback');
          return;
        }
        setImgStage('failed');
      }}
      className={cn(
        box,
        'rounded-full object-contain shrink-0 p-0.5',
        onDark ? 'bg-white border-2 border-white/30 shadow-sm' : 'bg-white border border-gray-200 shadow-sm',
        className,
      )}
      loading="lazy"
    />
  );
}
