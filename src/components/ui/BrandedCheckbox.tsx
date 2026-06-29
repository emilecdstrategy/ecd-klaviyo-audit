import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

type BrandedCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'lg';
  'aria-label'?: string;
};

const SIZE_CLASS = {
  sm: 'h-4 w-4 rounded',
  lg: 'h-6 w-6 rounded-md',
} as const;

const ICON_CLASS = {
  sm: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
} as const;

export default function BrandedCheckbox({
  checked,
  onChange,
  className,
  disabled,
  size = 'sm',
  'aria-label': ariaLabel,
}: BrandedCheckboxProps) {
  return (
    <label
      className={cn(
        'inline-flex shrink-0 cursor-pointer',
        size === 'lg' && 'p-0.5',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={event => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex items-center justify-center border',
          SIZE_CLASS[size],
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary/30 peer-focus-visible:ring-offset-1',
          checked
            ? 'border-brand-primary bg-brand-primary text-white'
            : 'border-gray-300 bg-white hover:border-brand-primary/40',
        )}
      >
        {checked ? <Check className={ICON_CLASS[size]} strokeWidth={3} aria-hidden /> : null}
      </span>
    </label>
  );
}
