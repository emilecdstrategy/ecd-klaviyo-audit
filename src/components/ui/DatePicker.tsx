import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

/** A branded date picker, replacing <input type="date">.
 *
 * The native control renders the operating system's own calendar: Chrome blue
 * selection, system fonts, a layout we cannot touch. That is jarring next to
 * everything else in the app, and it looks different on every machine the team
 * uses, so this draws the calendar itself.
 *
 * Values are YYYY-MM-DD strings, matching the DATE columns these fields save to
 * (valid_until), and every date is built and compared in LOCAL time. Parsing
 * "2026-09-13" with new Date() would read it as UTC and land on the 12th for
 * anyone behind it, which is exactly the sort of off-by-one an expiry date
 * cannot afford.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** YYYY-MM-DD for a local date, never via toISOString (which shifts to UTC). */
function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse YYYY-MM-DD as a LOCAL date. */
function fromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((key ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDisplay(key: string): string {
  const d = fromKey(key);
  if (!d) return 'Pick a date';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DatePicker({
  value,
  onChange,
  min,
  disabled,
  className,
  ariaLabel = 'Choose a date',
}: {
  /** YYYY-MM-DD, or '' when unset. */
  value: string;
  onChange: (next: string) => void;
  /** YYYY-MM-DD; earlier days render disabled. */
  min?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = fromKey(value);
  const today = new Date();
  const todayKey = toKey(today);
  // The month on screen. Follows the selected date when it changes (reopening on
  // a different value should not strand you in the old month).
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selected ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  useEffect(() => {
    const base = fromKey(value) ?? new Date();
    setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [value]);

  // Close on outside click or Escape, the same as the app's other popovers.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The 6x7 grid: leading days from the previous month, this month, then enough
  // of the next to fill the final row, so the calendar never changes height.
  const cells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { date: d, key: toKey(d), inMonth: d.getMonth() === viewMonth.getMonth() };
    });
  }, [viewMonth]);

  const minKey = (min ?? '').trim();
  const shiftMonth = (delta: number) =>
    setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const pick = (key: string) => {
    if (minKey && key < minKey) return;
    onChange(key);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          open ? 'border-brand-primary ring-2 ring-brand-primary/20' : 'border-gray-200 hover:bg-gray-50'
        } ${value ? 'text-gray-900' : 'text-gray-400'}`}
      >
        <CalendarIcon className="h-3.5 w-3.5 text-gray-400" />
        {formatDisplay(value)}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className="absolute right-0 z-50 mt-1.5 w-[268px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-gray-900">
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map(w => (
              <span key={w} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map(({ date, key, inMonth }) => {
              const isSelected = key === value;
              const isToday = key === todayKey;
              const isBlocked = Boolean(minKey) && key < minKey;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isBlocked}
                  onClick={() => pick(key)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  className={`h-8 rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-brand-primary text-white'
                      : isBlocked
                        ? 'cursor-not-allowed text-gray-200'
                        : inMonth
                          ? 'text-gray-700 hover:bg-brand-primary/10 hover:text-brand-primary'
                          : 'text-gray-300 hover:bg-gray-50'
                  } ${isToday && !isSelected ? 'ring-1 ring-inset ring-brand-primary/40' : ''}`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => pick(todayKey)}
              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/5"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
