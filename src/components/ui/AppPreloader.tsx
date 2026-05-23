import { cn } from '../../lib/utils';

type AppPreloaderProps = {
  message?: string;
  compact?: boolean;
  className?: string;
};

export default function AppPreloader({
  message = 'Loading…',
  compact = false,
  className,
}: AppPreloaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex items-center justify-center animate-fade-in',
        compact ? 'py-16' : 'min-h-screen bg-[#f9f9f9] p-6',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-2xl border-2 border-brand-primary/10" aria-hidden />
          <div
            className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-brand-primary animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          <img
            src="/cropped-favicon-192x192.webp"
            alt="ECD Digital Strategy"
            className="relative h-14 w-14 rounded-xl object-cover shadow-md ring-1 ring-black/5"
            width={56}
            height={56}
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight text-gray-900">ECD Digital Strategy</p>
          {message ? <p className="mt-1 text-xs text-gray-500">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
