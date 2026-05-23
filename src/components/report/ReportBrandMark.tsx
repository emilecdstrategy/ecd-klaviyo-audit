import { cn } from '../../lib/utils';

type Size = 'sm' | 'md' | 'lg';

const sizeClasses: Record<Size, { img: string; title: string; subtitle: string; gap: string }> = {
  sm: { img: 'h-7 w-7', title: 'text-sm', subtitle: 'text-[10px]', gap: 'gap-2' },
  md: { img: 'h-9 w-9', title: 'text-sm', subtitle: 'text-xs', gap: 'gap-3' },
  lg: { img: 'h-11 w-11', title: 'text-base', subtitle: 'text-xs', gap: 'gap-3.5' },
};

export default function ReportBrandMark({
  size = 'md',
  inverted = false,
  subtitle = 'Klaviyo Email Audit',
}: {
  size?: Size;
  inverted?: boolean;
  subtitle?: string;
}) {
  const s = sizeClasses[size];
  return (
    <div className={cn('flex items-center', s.gap)}>
      <img
        src="/cropped-favicon-192x192.webp"
        alt="ECD Digital Strategy"
        className={cn(s.img, 'rounded-lg object-cover shadow-sm ring-1', inverted ? 'ring-white/20' : 'ring-black/5')}
      />
      <div>
        <span className={cn(s.title, 'font-bold leading-tight block', inverted ? 'text-white' : 'text-gray-900')}>
          ECD Digital Strategy
        </span>
        <span className={cn(s.subtitle, 'block -mt-0.5 leading-none', inverted ? 'text-white/70' : 'text-gray-500')}>
          {subtitle}
        </span>
      </div>
    </div>
  );
}
