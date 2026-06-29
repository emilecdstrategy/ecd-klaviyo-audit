import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { RevenueOpportunityTemplate } from '../../lib/types';
import {
  ADDON_CATEGORY_LABELS,
  ADDON_CATEGORY_ORDER,
  groupTemplatesByCategory,
  summarizeTemplatePricing,
} from '../../lib/revenue-addon-categories';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';

export default function AddOpportunityPickerModal({
  open,
  templates,
  onClose,
  onSelect,
}: {
  open: boolean;
  templates: RevenueOpportunityTemplate[];
  onClose: () => void;
  onSelect: (template: RevenueOpportunityTemplate) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q),
    );
  }, [templates, query]);

  const grouped = useMemo(() => groupTemplatesByCategory(filtered), [filtered]);

  return (
    <Modal
      open={open}
      title="Add from opportunity library"
      onClose={onClose}
      className="max-w-4xl"
    >
      <div className="px-5 pb-5">
        <p className="text-sm text-gray-600 mb-4">
          Pick a predefined service or Klaviyo add-on. You can customize pricing and copy after adding it to this audit.
        </p>

        <div className="relative mb-5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search opportunities…"
            className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-3 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
            {templates.length === 0
              ? 'All library templates are already in this audit.'
              : 'No templates match your search.'}
          </div>
        ) : (
          <div className="space-y-6">
            {ADDON_CATEGORY_ORDER.map(category => {
              const items = grouped[category];
              if (items.length === 0) return null;
              return (
                <section key={category}>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    {ADDON_CATEGORY_LABELS[category]}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map(template => {
                      const pricing = summarizeTemplatePricing(template);
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => onSelect(template)}
                          className={cn(
                            'group flex flex-col rounded-xl border border-gray-100 bg-white p-4 text-left transition-colors',
                            'hover:border-brand-primary/30 hover:bg-brand-primary/[0.03]',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-900 group-hover:text-brand-primary">
                              {template.name}
                            </span>
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 group-hover:border-brand-primary/30 group-hover:text-brand-primary">
                              <Plus className="h-3.5 w-3.5" />
                            </span>
                          </div>
                          {template.description ? (
                            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                              {template.description}
                            </p>
                          ) : null}
                          {pricing ? (
                            <p className="mt-2 text-[11px] font-medium text-gray-600">{pricing}</p>
                          ) : (
                            <p className="mt-2 text-[11px] text-gray-400">Pricing set per audit</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
