import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Audit } from '../../lib/types';
import { updateAudit } from '../../lib/db';
import { DEFAULT_EXECUTIVE_SUMMARY_SECTION } from '../../lib/report-config/defaults';
import type { ExecutiveSummarySectionConfig } from '../../lib/report-config/types';

/**
 * Editor for the Executive Summary / hero block at the top of the public report.
 *
 * The hero sits above the numbered sections and isn't backed by an
 * `audit_sections` row, so its overrides live on `audits.layout.executive_summary`.
 */
export default function ExecutiveSummaryLayoutEditor({
  audit,
  onAuditChange,
}: {
  audit: Audit;
  onAuditChange: (next: Audit) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const saveTimer = useRef<number | null>(null);

  const layout = useMemo(
    () => ((audit.layout as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>,
    [audit.layout],
  );

  const raw = useMemo(() => {
    const bucket = layout.executive_summary;
    return bucket && typeof bucket === 'object' && !Array.isArray(bucket)
      ? (bucket as Partial<ExecutiveSummarySectionConfig>)
      : ({} as Partial<ExecutiveSummarySectionConfig>);
  }, [layout]);

  const blocksRaw = useMemo(() => {
    const b = raw.blocks as Record<string, Record<string, unknown>> | undefined;
    return b ?? {};
  }, [raw]);

  const sectionHidden = Boolean(raw.hidden);

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
    const nextSection = { ...raw, ...patch };
    scheduleSave({ ...layout, executive_summary: nextSection });
  };

  const writeBlockPatch = (blockKey: string, patch: Record<string, unknown>) => {
    const prevBlock = (blocksRaw[blockKey] ?? {}) as Record<string, unknown>;
    const nextBlock = { ...prevBlock, ...patch };
    const nextBlocks = { ...blocksRaw, [blockKey]: nextBlock };
    const nextSection = { ...raw, blocks: nextBlocks };
    scheduleSave({ ...layout, executive_summary: nextSection });
  };

  const BLOCKS: {
    key: string;
    label: string;
    hint: string;
    hasTitle?: boolean;
    extras?: Array<{ key: 'headline' | 'intro' | 'eyebrow'; label: string; hint?: string; textarea?: boolean }>;
  }[] = [
    {
      key: 'hero',
      label: 'Hero headline + intro',
      hint: '"X could unlock $Y/month" banner with the intro paragraph underneath.',
      hasTitle: false,
      extras: [
        {
          key: 'eyebrow',
          label: 'Eyebrow tag',
          hint: 'Leave blank to use the default "Klaviyo Email Audit — {company}". Type [hide] to remove it entirely.',
        },
        {
          key: 'headline',
          label: 'Headline',
          hint: 'Leave blank to auto-generate. Type [hide] to remove.',
          textarea: true,
        },
        {
          key: 'intro',
          label: 'Intro paragraph',
          hint: 'Leave blank to use the AI-generated first sentence. Type [hide] to remove.',
          textarea: true,
        },
      ],
    },
    {
      key: 'accountSnapshot',
      label: 'Account Snapshot card',
      hint: 'Metrics panel (subscribers, bounce rate, revenue mix, etc.).',
      hasTitle: true,
    },
    {
      key: 'strengths',
      label: "What's Working column",
      hint: 'Left-hand column of AI-generated strengths.',
      hasTitle: true,
    },
    {
      key: 'concerns',
      label: 'What Needs Attention column',
      hint: 'Right-hand column of AI-generated concerns.',
      hasTitle: true,
    },
    {
      key: 'topOpportunities',
      label: 'Top 3 Opportunities cards',
      hint: 'Three opportunity cards pulled from the top section-level revenue opportunities.',
      hasTitle: true,
    },
  ];

  const renderExtraValue = (cfg: Record<string, unknown>, key: 'headline' | 'intro' | 'eyebrow') => {
    const v = cfg[key];
    if (v === null) return '[hide]';
    if (typeof v === 'string') return v;
    return '';
  };

  const writeExtra = (
    blockKey: string,
    key: 'headline' | 'intro' | 'eyebrow',
    raw: string,
  ) => {
    const next = raw.trim() === '[hide]' ? null : raw === '' ? undefined : raw;
    writeBlockPatch(blockKey, { [key]: next });
  };

  return (
    <div className="bg-white rounded-xl card-shadow">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900">Executive Summary layout</h3>
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
                  Hide entire Executive Summary section from the public report
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Removes the hero, snapshot, and top-3 cards. Later sections renumber automatically.
                </div>
              </div>
            </label>
          </div>

          <div className="rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Executive Summary section layout
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Section title</label>
                <input
                  type="text"
                  value={raw.sectionTitle ?? ''}
                  placeholder={DEFAULT_EXECUTIVE_SUMMARY_SECTION.sectionTitle ?? ''}
                  onChange={e => writeSectionPatch({ sectionTitle: e.target.value || undefined })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Section number</label>
                <input
                  type="text"
                  value={raw.sectionNumber ?? ''}
                  placeholder={DEFAULT_EXECUTIVE_SUMMARY_SECTION.sectionNumber ?? ''}
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
                  (DEFAULT_EXECUTIVE_SUMMARY_SECTION.blocks as Record<string, Record<string, unknown>>)[block.key] ?? {};
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
                        {block.hasTitle && (
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Block title</label>
                            <input
                              type="text"
                              value={(bcfg.title as string | undefined) ?? ''}
                              placeholder={(defaultBlock.title as string | undefined) ?? ''}
                              onChange={e => writeBlockPatch(block.key, { title: e.target.value || undefined })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                        )}
                        {block.extras?.map(extra => (
                          <div key={extra.key}>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">
                              {extra.label}
                            </label>
                            {extra.textarea ? (
                              <textarea
                                rows={3}
                                value={renderExtraValue(bcfg, extra.key)}
                                onChange={e => writeExtra(block.key, extra.key, e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                              />
                            ) : (
                              <input
                                type="text"
                                value={renderExtraValue(bcfg, extra.key)}
                                onChange={e => writeExtra(block.key, extra.key, e.target.value)}
                                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                              />
                            )}
                            {extra.hint && (
                              <p className="text-[11px] text-gray-400 mt-0.5">{extra.hint}</p>
                            )}
                          </div>
                        ))}
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
