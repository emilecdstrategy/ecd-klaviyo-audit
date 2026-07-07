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
        'flex items-center justify-center animate-fade-in bg-[#f9f9f9]',
        compact
          ? 'flex-1 w-full min-h-0'
          : 'fixed inset-0 z-50 min-h-[100dvh]',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <svg
            className="absolute inset-0 h-full w-full animate-spin motion-reduce:animate-none"
            viewBox="0 0 80 80"
            aria-hidden
          >
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-brand-primary/15"
            />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-brand-primary"
              strokeDasharray="54 160"
            />
          </svg>
          <img
            src="/cropped-favicon-192x192.webp"
            alt="ECD Digital Strategy"
            className="relative h-12 w-12 rounded-full object-cover shadow-md ring-2 ring-white"
            width={48}
            height={48}
            // React 18 only forwards the lowercase form to the DOM (camelCase
            // fetchPriority is dropped with a warning; supported in React 19+).
            {...({ fetchpriority: 'high' } as object)}
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
