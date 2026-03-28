import { useState, useEffect, useCallback } from 'react';
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
import { listCustomIndustries, createCustomIndustry } from '../../lib/db';
import { cn } from '../../lib/utils';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from './select';

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
  iconClassName?: string;
}) {
  const Icon = INDUSTRY_ICONS[industry] ?? MoreHorizontal;
  return (
    <span className={cn('inline-flex shrink-0 text-gray-400', className)} aria-hidden>
      <Icon className={cn('h-4 w-4', iconClassName)} strokeWidth={1.5} />
    </span>
  );
}

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
          industry={INDUSTRY_ICONS[value] ? value : 'Other'}
          iconClassName={iconSize === 'sm' ? 'h-3.5 w-3.5' : undefined}
        />
      ) : null}
      <SelectValue placeholder={placeholder} className="min-w-0 truncate text-left" />
    </span>
  );
}

export function IndustrySelectItems({ customIndustries = [] }: { customIndustries?: string[] }) {
  const builtInWithoutOther = INDUSTRIES.filter(i => i !== 'Other');
  return (
    <>
      {builtInWithoutOther.map(industry => (
        <SelectItem key={industry} value={industry}>
          <span className="flex items-center gap-2.5">
            <IndustryIcon industry={industry} />
            <SelectItemText>{industry}</SelectItemText>
          </span>
        </SelectItem>
      ))}
      {customIndustries.map(name => (
        <SelectItem key={`custom-${name}`} value={name}>
          <span className="flex items-center gap-2.5">
            <IndustryIcon industry="Other" />
            <SelectItemText>{name}</SelectItemText>
          </span>
        </SelectItem>
      ))}
      <SelectItem value="__other__">
        <span className="flex items-center gap-2.5">
          <IndustryIcon industry="Other" />
          <SelectItemText>+ Add new industry…</SelectItemText>
        </span>
      </SelectItem>
    </>
  );
}

/**
 * Full industry select with custom-industry support.
 * When the user picks "+ Add new industry…", a small inline dialog appears.
 */
export function IndustrySelectWithCustom({
  value,
  onValueChange,
  placeholder = 'Select industry...',
  iconSize = 'md',
  triggerClassName,
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  iconSize?: 'sm' | 'md';
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const [customIndustries, setCustomIndustries] = useState<string[]>([]);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCustom = useCallback(async () => {
    try {
      const list = await listCustomIndustries();
      setCustomIndustries(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadCustom(); }, [loadCustom]);

  const handleSelect = (v: string) => {
    if (v === '__other__') {
      setShowCustomInput(true);
      setCustomName('');
      return;
    }
    onValueChange(v);
  };

  const handleSaveCustom = async () => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    try {
      setSaving(true);
      await createCustomIndustry(trimmed);
      setCustomIndustries(prev => [...prev, trimmed].sort());
      onValueChange(trimmed);
      setShowCustomInput(false);
      setCustomName('');
    } catch {
      onValueChange(trimmed);
      setShowCustomInput(false);
      setCustomName('');
    } finally {
      setSaving(false);
    }
  };

  if (showCustomInput) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customName}
          onChange={e => setCustomName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSaveCustom(); if (e.key === 'Escape') setShowCustomInput(false); }}
          placeholder="Enter industry name…"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          autoFocus
          disabled={saving}
        />
        <button
          onClick={handleSaveCustom}
          disabled={saving || !customName.trim()}
          className="px-3 py-2 text-sm font-medium text-white bg-brand-primary rounded-lg hover:bg-brand-primary-dark transition-colors disabled:opacity-50"
        >
          {saving ? '…' : 'Add'}
        </button>
        <button
          onClick={() => setShowCustomInput(false)}
          className="px-2 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  const allOptions = [...INDUSTRIES.filter(i => i !== 'Other'), ...customIndustries];
  const displayValue = value && allOptions.includes(value) ? value : value || undefined;

  return (
    <Select value={displayValue} onValueChange={handleSelect} disabled={disabled}>
      <SelectTrigger className={triggerClassName ?? 'w-full'}>
        <IndustrySelectTriggerContent value={displayValue} placeholder={placeholder} iconSize={iconSize} />
      </SelectTrigger>
      <SelectContent>
        <IndustrySelectItems customIndustries={customIndustries} />
      </SelectContent>
    </Select>
  );
}
