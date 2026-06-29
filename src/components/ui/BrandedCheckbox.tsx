import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

type BrandedCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

export default function BrandedCheckbox({
  checked,
  onChange,
  className,
  disabled,
  'aria-label': ariaLabel,
}: BrandedCheckboxProps) {
  return (
    <label
      className={cn(
        'inline-flex shrink-0 cursor-pointer',
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
          'flex h-4 w-4 items-center justify-center rounded border-2 transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-primary/30 peer-focus-visible:ring-offset-1',
          checked
            ? 'border-brand-primary bg-brand-primary text-white shadow-sm shadow-brand-primary/20'
            : 'border-gray-300 bg-white hover:border-brand-primary/40',
        )}
      >
        {checked ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : null}
      </span>
    </label>
  );
}
