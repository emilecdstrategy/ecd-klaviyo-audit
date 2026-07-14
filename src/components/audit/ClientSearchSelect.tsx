import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import SiteFavicon from '../ui/SiteFavicon';
import { formatClientListMeta } from '../../lib/client-display';
import type { Client } from '../../lib/types';

type ClientSearchSelectProps = {
  clients: Client[];
  value: string;
  onSelect: (clientId: string) => void;
  onClear?: () => void;
  placeholder?: string;
};

/** Searchable client picker. Replaces the plain Radix Select so long client lists are filterable. */
export default function ClientSearchSelect({
  clients,
  value,
  onSelect,
  onClear,
  placeholder = 'Create new client or select existing',
}: ClientSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? clients.find(c => c.id === value) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      c.company_name.toLowerCase().includes(q) ||
      (c.name || '').toLowerCase().includes(q) ||
      (c.industry || '').toLowerCase().includes(q),
    );
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    // Focus the search field when the panel opens.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <SiteFavicon url={selected.website_url} />
            <span className="truncate font-medium">{selected.company_name}</span>
          </span>
        ) : (
          <span className="truncate text-gray-400">{placeholder}</span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          {selected && onClear && (
            <X
              className="h-4 w-4 text-gray-400 hover:text-gray-700"
              onClick={e => {
                e.stopPropagation();
                onClear();
                setQuery('');
              }}
            />
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          <div className="max-h-[min(320px,60vh)] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">No clients match “{query}”.</p>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelect(c.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-brand-primary/5 ${
                    c.id === value ? 'bg-brand-primary/5' : ''
                  }`}
                >
                  <SiteFavicon url={c.website_url} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium leading-snug text-gray-900">{c.company_name}</span>
                    <span className="truncate text-[11px] leading-snug text-gray-500">{formatClientListMeta(c)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
