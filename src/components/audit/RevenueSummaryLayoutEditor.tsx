import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Audit, RevenueOpportunityAddOnItem, RevenueOpportunityTemplate } from '../../lib/types';
import { listRevenueOpportunityTemplates, updateAudit } from '../../lib/db';
import { DEFAULT_REVENUE_SUMMARY_SECTION } from '../../lib/report-config/defaults';
import type { RevenueSummarySectionConfig } from '../../lib/report-config/types';

/**
 * Editor for the Revenue Summary section's layout overrides.
 *
 * Unlike the other sections, `revenue_summary` has no row in `audit_sections`
 * (it is computed from aggregates), so its overrides live on
 * `audits.layout.revenue_summary` instead.
 */
export default function RevenueSummaryLayoutEditor({
  audit,
  onAuditChange,
}: {
  audit: Audit;
  onAuditChange: (next: Audit) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [templates, setTemplates] = useState<RevenueOpportunityTemplate[]>([]);
  const [selectedTemplateSlug, setSelectedTemplateSlug] = useState('');
  const saveTimer = useRef<number | null>(null);

  const layout = useMemo(() => {
    const raw = (audit.layout as Record<string, unknown> | null | undefined) ?? {};
    return raw;
  }, [audit.layout]);

  const rsRaw = useMemo(() => {
    const bucket = layout.revenue_summary;
    return bucket && typeof bucket === 'object' && !Array.isArray(bucket)
      ? (bucket as Partial<RevenueSummarySectionConfig>)
      : ({} as Partial<RevenueSummarySectionConfig>);
  }, [layout]);

  const blocksRaw = useMemo(() => {
    const b = rsRaw.blocks as Record<string, Record<string, unknown>> | undefined;
    return b ?? {};
  }, [rsRaw]);

  const sectionHidden = Boolean(rsRaw.hidden);
  const addOnItems = useMemo(() => {
    const addOns = blocksRaw.addOns;
    const rawItems = addOns?.items;
    if (!Array.isArray(rawItems)) return [] as RevenueOpportunityAddOnItem[];
    return rawItems
      .filter((item): item is RevenueOpportunityAddOnItem => !!item && typeof item === 'object')
      .map((item, index) => ({
        template_slug: String(item.template_slug ?? ''),
        name: String(item.name ?? ''),
        description: item.description ? String(item.description) : undefined,
        bullets: Array.isArray(item.bullets) ? item.bullets.map(v => String(v)) : [],
        revenue_monthly: Number(item.revenue_monthly ?? 0),
        is_hidden: Boolean(item.is_hidden),
        display_order: typeof item.display_order === 'number' ? item.display_order : (index + 1) * 10,
      }));
  }, [blocksRaw]);

  const sortedAddOnItems = useMemo(
    () => [...addOnItems].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)),
    [addOnItems],
  );

  useEffect(() => {
    listRevenueOpportunityTemplates({ activeOnly: true })
      .then((data) => {
        setTemplates(data);
        if (!selectedTemplateSlug && data.length > 0) {
          setSelectedTemplateSlug(data[0].slug);
        }
      })
      .catch(() => {
        setTemplates([]);
      });
  }, [selectedTemplateSlug]);

  const scheduleSave = (nextLayout: Record<string, unknown>) => {
    onAuditChange({ ...audit, layout: nextLayout });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await updateAudit(audit.id, { layout: nextLayout });
      } catch {
        /* silent */
      }
    }, 500) as unknown as number;
  };

  const writeSectionPatch = (
    patch: { hidden?: boolean; sectionTitle?: string; sectionNumber?: string },
  ) => {
    const nextSection = { ...rsRaw, ...patch };
    const nextLayout = { ...layout, revenue_summary: nextSection };
    scheduleSave(nextLayout);
  };

  const writeBlockPatch = (
    blockKey: string,
    patch: Record<string, unknown>,
  ) => {
    const prevBlock = (blocksRaw[blockKey] ?? {}) as Record<string, unknown>;
    const nextBlock = { ...prevBlock, ...patch };
    const nextBlocks = { ...blocksRaw, [blockKey]: nextBlock };
    const nextSection = { ...rsRaw, blocks: nextBlocks };
    const nextLayout = { ...layout, revenue_summary: nextSection };
    scheduleSave(nextLayout);
  };

  const writeAddOnItems = (items: RevenueOpportunityAddOnItem[]) => {
    writeBlockPatch('addOns', { items });
  };

  const BLOCKS: { key: string; label: string; hint: string; supportsSubtitle?: boolean; supportsDisclaimer?: boolean }[] = [
    {
      key: 'metrics',
      label: 'Current vs Potential Revenue Cards',
      hint: 'Top two cards showing current and potential monthly revenue.',
    },
    {
      key: 'totalBanner',
      label: 'Total Opportunity Banner',
      hint: 'Large brand-coloured banner with the total identified monthly opportunity.',
      supportsSubtitle: true,
      supportsDisclaimer: true,
    },
    {
      key: 'addOns',
      label: 'Predefined Add-On Opportunities',
      hint: 'Cards for selected predefined opportunities (e.g. Klaviyo SMS, Customer Agent).',
      supportsSubtitle: true,
    },
    {
      key: 'timeline',
      label: 'Implementation Timeline',
      hint: 'AI-generated rollout phases shown at the bottom of the section.',
      supportsSubtitle: true,
    },
  ];

  return (
    <div className="bg-white rounded-xl card-shadow">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900">Report layout</h3>
          {sectionHidden && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              Hidden in report
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-50 px-6 py-5 space-y-5">
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sectionHidden}
                onChange={e => writeSectionPatch({ hidden: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/20"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800">
                  Hide entire Revenue Opportunity section from the public report
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  The section, its nav item, and all blocks are skipped. Later sections renumber automatically.
                </div>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Revenue Opportunity section layout
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Section title</label>
                <input
                  type="text"
                  value={rsRaw.sectionTitle ?? DEFAULT_REVENUE_SUMMARY_SECTION.sectionTitle ?? ''}
                  onChange={e => writeSectionPatch({ sectionTitle: e.target.value || undefined })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Section number</label>
                <input
                  type="text"
                  value={rsRaw.sectionNumber ?? DEFAULT_REVENUE_SUMMARY_SECTION.sectionNumber ?? ''}
                  onChange={e => writeSectionPatch({ sectionNumber: e.target.value || undefined })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Blocks</p>
            <div className="space-y-2">
              {BLOCKS.map(block => {
                const bcfg = (blocksRaw[block.key] ?? {}) as Record<string, unknown>;
                const defaultBlock =
                  (DEFAULT_REVENUE_SUMMARY_SECTION.blocks as Record<string, Record<string, unknown>>)[block.key] ??
                  {};
                const hidden = Boolean(bcfg.hidden);
                return (
                  <div key={block.key} className="rounded-lg border border-gray-100">
                    <label className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={e => writeBlockPatch(block.key, { hidden: !e.target.checked })}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/20"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-800">{block.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{block.hint}</div>
                      </div>
                    </label>
                    {!hidden && (
                      <div className="px-3 pb-3 space-y-2">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">Block title</label>
                          <input
                            type="text"
                            value={(bcfg.title as string | undefined) ?? (defaultBlock.title as string | undefined) ?? ''}
                            onChange={e => writeBlockPatch(block.key, { title: e.target.value || undefined })}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          />
                        </div>
                        {block.supportsSubtitle && (
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Subtitle</label>
                            <input
                              type="text"
                              value={(bcfg.subtitle as string | undefined) ?? (defaultBlock.subtitle as string | undefined) ?? ''}
                              onChange={e => writeBlockPatch(block.key, { subtitle: e.target.value || undefined })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                        )}
                        {block.supportsDisclaimer && (
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">
                              Disclaimer (leave blank to use default; set to &quot;[hide]&quot; to remove it)
                            </label>
                            <textarea
                              rows={3}
                              value={
                                bcfg.disclaimer === null
                                  ? '[hide]'
                                  : typeof bcfg.disclaimer === 'string'
                                    ? bcfg.disclaimer
                                    : ((defaultBlock.disclaimer as string | undefined) ?? '')
                              }
                              onChange={e => {
                                const raw = e.target.value;
                                const next =
                                  raw.trim() === '[hide]'
                                    ? null
                                    : raw === ''
                                      ? undefined
                                      : raw;
                                writeBlockPatch(block.key, { disclaimer: next });
                              }}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add-On Opportunity Items</p>
            <p className="text-xs text-gray-500 mb-3">
              These cards are shown in the public report and included in total identified opportunity.
            </p>

            {sortedAddOnItems.length === 0 ? (
              <div className="text-xs text-gray-500 rounded-lg border border-dashed border-gray-200 px-3 py-3">
                No add-ons selected for this audit yet.
              </div>
            ) : (
              <div className="space-y-3">
                {sortedAddOnItems.map((item) => (
                  <div key={`${item.template_slug}-${item.display_order}`} className="rounded-lg border border-gray-100 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-500 min-w-[95px]">Name</label>
                      <input
                        type="text"
                        value={item.name}
                        onChange={e => {
                          writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, name: e.target.value } : row));
                        }}
                        className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-gray-500 min-w-[95px]">Description</label>
                      <input
                        type="text"
                        value={item.description ?? ''}
                        onChange={e => {
                          writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, description: e.target.value || undefined } : row));
                        }}
                        className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      />
                    </div>
                    <div className="flex items-start gap-2">
                      <label className="text-xs font-medium text-gray-500 min-w-[95px] mt-2">Bullets</label>
                      <textarea
                        rows={3}
                        value={item.bullets.join('\n')}
                        onChange={e => {
                          const nextBullets = e.target.value.split('\n').map(v => v.trim()).filter(Boolean);
                          writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, bullets: nextBullets } : row));
                        }}
                        className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Revenue ($/mo)</label>
                        <input
                          type="number"
                          value={item.revenue_monthly}
                          onChange={e => {
                            writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, revenue_monthly: Number(e.target.value || 0) } : row));
                          }}
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Display order</label>
                        <input
                          type="number"
                          value={item.display_order ?? 0}
                          onChange={e => {
                            writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, display_order: Number(e.target.value || 0) } : row));
                          }}
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
                        <input
                          type="checkbox"
                          checked={!item.is_hidden}
                          onChange={e => {
                            writeAddOnItems(sortedAddOnItems.map(row => row === item ? { ...row, is_hidden: !e.target.checked } : row));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-brand-primary focus:ring-brand-primary/20"
                        />
                        Show in report
                      </label>
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          writeAddOnItems(sortedAddOnItems.filter(row => row !== item));
                        }}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Remove from this audit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Add from template</label>
                <select
                  value={selectedTemplateSlug}
                  onChange={e => setSelectedTemplateSlug(e.target.value)}
                  className="w-full px-2.5 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                >
                  {templates
                    .filter(template => !sortedAddOnItems.some(item => item.template_slug === template.slug))
                    .map(template => (
                      <option key={template.id} value={template.slug}>
                        {template.name}
                      </option>
                    ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  const template = templates.find(t => t.slug === selectedTemplateSlug);
                  if (!template) return;
                  if (sortedAddOnItems.some(item => item.template_slug === template.slug)) return;
                  const nextOrder = sortedAddOnItems.reduce((max, row) => Math.max(max, row.display_order ?? 0), 0) + 10;
                  writeAddOnItems([
                    ...sortedAddOnItems,
                    {
                      template_slug: template.slug,
                      name: template.name,
                      description: template.description || undefined,
                      bullets: template.bullets ?? [],
                      revenue_monthly: Number(template.default_revenue_monthly ?? 0),
                      display_order: nextOrder,
                      is_hidden: false,
                    },
                  ]);
                }}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
              >
                Add opportunity
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
