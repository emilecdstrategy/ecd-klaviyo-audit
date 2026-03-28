import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatClientListMeta } from '../../lib/client-display';
import { searchAudits, searchClients } from '../../lib/db';
import type { Audit, Client } from '../../lib/types';

type Result =
  | { type: 'client'; item: Client }
  | { type: 'audit'; item: Audit };

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q, 200);
  const [clients, setClients] = useState<Client[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);

  const results: Result[] = useMemo(() => {
    const r: Result[] = [];
    clients.forEach(c => r.push({ type: 'client', item: c }));
    audits.forEach(a => r.push({ type: 'audit', item: a }));
    return r;
  }, [clients, audits]);

  useEffect(() => {
    let cancelled = false;
    const query = debounced.trim();
    if (!query) {
      setClients([]);
      setAudits([]);
      setError('');
      setLoading(false);
      setActiveIndex(0);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [c, a] = await Promise.all([searchClients(query, 5), searchAudits(query, 5)]);
        if (cancelled) return;
        setClients(c);
        setAudits(a);
        setActiveIndex(0);
        setOpen(true);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const onPick = (r: Result) => {
    setOpen(false);
    setQ('');
    if (r.type === 'client') navigate(`/clients/${r.item.id}`);
    else navigate(`/audits/${r.item.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) setOpen(true);
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(0, results.length - 1)));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter') {
      const r = results[activeIndex];
      if (r) onPick(r);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        onFocus={() => q.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search clients and audits..."
        className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 w-72 transition-all"
      />

      {open && (q.trim() || loading || error) && (
        <div className="absolute right-0 mt-2 w-[420px] max-w-[calc(100vw-2rem)] bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden z-50">
          <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Search results</span>
            {loading && <span className="text-xs text-gray-400">Searching…</span>}
          </div>

          {error ? (
            <div className="p-4 text-sm text-red-600 bg-red-50">{error}</div>
          ) : results.length === 0 && !loading ? (
            <div className="p-4 text-sm text-gray-500">No matches.</div>
          ) : (
            <div className="max-h-[320px] overflow-auto">
              {clients.length > 0 && (
                <Section title="Clients" icon={Users}>
                  {clients.map((c, idx) => {
                    const absoluteIndex = idx;
                    const active = absoluteIndex === activeIndex;
                    return (
                      <Row
                        key={c.id}
                        active={active}
                        title={c.company_name}
                        subtitle={formatClientListMeta(c)}
                        onClick={() => onPick({ type: 'client', item: c })}
                        onMouseEnter={() => setActiveIndex(absoluteIndex)}
                      />
                    );
                  })}
                </Section>
              )}

              {audits.length > 0 && (
                <Section title="Audits" icon={FileText}>
                  {audits.map((a, idx) => {
                    const absoluteIndex = clients.length + idx;
                    const active = absoluteIndex === activeIndex;
                    const ranAt = (a.updated_at || (a as any).created_at)
                      ? new Date((a.updated_at || (a as any).created_at) as any)
                      : null;
                    const ranLabel = ranAt ? ranAt.toLocaleDateString() : '';
                    const statusLabel = a.status.replace('_', ' ');
                    const subtitle = ranLabel ? `${statusLabel} • ${ranLabel}` : statusLabel;
                    return (
                      <Row
                        key={a.id}
                        active={active}
                        title={a.title}
                        subtitle={subtitle}
                        onClick={() => onPick({ type: 'audit', item: a })}
                        onMouseEnter={() => setActiveIndex(absoluteIndex)}
                      />
                    );
                  })}
                </Section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="px-4 py-1.5 flex items-center gap-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  title,
  subtitle,
  active,
  onClick,
  onMouseEnter,
}: {
  title: string;
  subtitle?: string;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full cursor-pointer text-left px-4 py-2.5 flex items-start justify-between gap-3 ${
        active ? 'bg-brand-primary/5' : 'hover:bg-gray-50'
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
        {subtitle && <div className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</div>}
      </div>
    </button>
  );
}
