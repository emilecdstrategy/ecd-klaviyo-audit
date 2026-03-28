import type { LucideIcon } from 'lucide-react';
import {
  Baby,
  Cpu,
  Gem,
  HeartPulse,
  MoreHorizontal,
  Mountain,
  PawPrint,
  Shirt,
  Sparkles,
  Sprout,
  UtensilsCrossed,
} from 'lucide-react';
import { INDUSTRIES } from '../../lib/constants';
import { cn } from '../../lib/utils';
import { SelectItem, SelectItemText, SelectValue } from './select';

const INDUSTRY_ICONS: Record<string, LucideIcon> = {
  'Home & Garden': Sprout,
  'Fashion & Apparel': Shirt,
  'Beauty & Skincare': Sparkles,
  'Food & Beverage': UtensilsCrossed,
  'Health & Wellness': HeartPulse,
  'Electronics & Tech': Cpu,
  'Sports & Outdoors': Mountain,
  'Jewelry & Accessories': Gem,
  'Pet Products': PawPrint,
  'Kids & Baby': Baby,
  Other: MoreHorizontal,
};

export function IndustryIcon({
  industry,
  className,
  iconClassName,
}: {
  industry: string;
  className?: string;
  /** Icon stroke/size overrides (wrapper stays flex) */
  iconClassName?: string;
}) {
  const Icon = INDUSTRY_ICONS[industry] ?? MoreHorizontal;
  return (
    <span className={cn('inline-flex shrink-0 text-gray-400', className)} aria-hidden>
      <Icon className={cn('h-4 w-4', iconClassName)} strokeWidth={1.5} />
    </span>
  );
}

/** Radix trigger row: icon + selected label */
export function IndustrySelectTriggerContent({
  value,
  placeholder,
  iconSize = 'md',
}: {
  value?: string;
  placeholder: string;
  iconSize?: 'sm' | 'md';
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      {value ? (
        <IndustryIcon
          industry={value}
          iconClassName={iconSize === 'sm' ? 'h-3.5 w-3.5' : undefined}
        />
      ) : null}
      <SelectValue placeholder={placeholder} className="min-w-0 truncate text-left" />
    </span>
  );
}

export function IndustrySelectItems() {
  return (
    <>
      {INDUSTRIES.map(industry => (
        <SelectItem key={industry} value={industry}>
          <span className="flex items-center gap-2.5">
            <IndustryIcon industry={industry} />
            <SelectItemText>{industry}</SelectItemText>
          </span>
        </SelectItem>
      ))}
    </>
  );
}
