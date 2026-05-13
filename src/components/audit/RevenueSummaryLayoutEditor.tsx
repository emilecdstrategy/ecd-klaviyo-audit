import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Audit } from '../../lib/types';
import { updateAudit } from '../../lib/db';
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
  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 pr-2">
                <div className="text-sm font-medium text-gray-800">
                  Hide entire Revenue Opportunity section from the public report
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  The section, its nav item, and all blocks are skipped. Later sections renumber automatically.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sectionHidden}
                onClick={() => writeSectionPatch({ hidden: !sectionHidden })}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${sectionHidden ? 'bg-brand-primary' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${sectionHidden ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
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
                    <div className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="text-sm font-medium text-gray-800">{block.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{block.hint}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!hidden}
                        onClick={() => writeBlockPatch(block.key, { hidden: !hidden })}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${!hidden ? 'bg-brand-primary' : 'bg-gray-200'}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${!hidden ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
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
        </div>
      )}
    </div>
  );
}
