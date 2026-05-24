import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, Check, RotateCcw } from 'lucide-react';
import type { AuditSection } from '../../lib/types';
import { SECTION_LABELS, CONFIDENCE_LABELS } from '../../lib/constants';
import {
  CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION,
} from '../../lib/core-flows-matrix';
import RevenueOpportunityCard from '../ui/RevenueOpportunityCard';
import StatusBadge from '../ui/StatusBadge';
import SimpleRichEditor from '../ui/SimpleRichEditor';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import {
  DEFAULT_ACCOUNT_HEALTH_SECTION,
  DEFAULT_CAMPAIGNS_SECTION,
  DEFAULT_EMAIL_DESIGN_SECTION,
  DEFAULT_FLOWS_SECTION,
  DEFAULT_FLOWS_VISIBLE_ROWS,
  DEFAULT_FLOWS_HEALTH_BENCHMARKS,
  DEFAULT_SEGMENTATION_SECTION,
  DEFAULT_SIGNUP_FORMS_SECTION,
} from '../../lib/report-config/defaults';
import { extractFlowsRawConfig, resolveFlowsConfig } from '../../lib/report-config/resolve';
import type {
  BaseSectionConfig,
  FlowsBlockKey,
  FlowsSectionConfig,
} from '../../lib/report-config/types';

interface AuditSectionEditorProps {
  section: AuditSection;
  onUpdate: (updates: Partial<AuditSection>) => void;
}

type TabKey = 'content' | 'layout' | 'benchmarks' | 'rubric';

const FLOWS_BLOCK_ORDER: { key: FlowsBlockKey; label: string; hint: string }[] = [
  { key: 'narrative', label: 'Narrative (Current vs Optimized)', hint: 'Leading current/optimized state commentary.' },
  { key: 'healthScore', label: 'Overall Flow Health Score', hint: 'Score ring + category table.' },
  { key: 'revenueBreakdown', label: 'Revenue Breakdown by Flow', hint: 'Top revenue-generating flows chart.' },
  { key: 'flowTable', label: 'Flow Performance Details', hint: 'Per-flow metrics table with overrides.' },
  { key: 'inventoryTable', label: 'Full Flow Inventory', hint: 'All flows pulled from Klaviyo.' },
  { key: 'rubric', label: 'Core Flows Matrix', hint: 'Structured rubric from AI analysis.' },
];

type GenericBlockDescriptor = {
  key: string;
  label: string;
  hint: string;
  kind: 'narrative' | 'titled' | 'titled-with-subtitle' | 'simple';
};

type GenericSectionDescriptor = {
  defaults: BaseSectionConfig & { blocks: Record<string, unknown> };
  blocks: GenericBlockDescriptor[];
};

const GENERIC_SECTION_REGISTRY: Record<string, GenericSectionDescriptor> = {
  account_health: {
    defaults: DEFAULT_ACCOUNT_HEALTH_SECTION,
    blocks: [
      {
        key: 'healthScoreTable',
        label: 'Health Score Table',
        hint: 'Category status table (flows, segmentation, campaigns, signup forms).',
        kind: 'simple',
      },
    ],
  },
  segmentation: {
    defaults: DEFAULT_SEGMENTATION_SECTION,
    blocks: [
      {
        key: 'narrative',
        label: 'Narrative (Current vs Optimized)',
        hint: 'Current/optimized state commentary plus key takeaway.',
        kind: 'narrative',
      },
      {
        key: 'rubric',
        label: 'Rubric',
        hint: 'Structured rubric notes from the AI analysis.',
        kind: 'titled',
      },
      {
        key: 'segmentTable',
        label: 'Segment Inventory Table',
        hint: 'All segments pulled from Klaviyo for this audit.',
        kind: 'titled-with-subtitle',
      },
    ],
  },
  signup_forms: {
    defaults: DEFAULT_SIGNUP_FORMS_SECTION,
    blocks: [
      {
        key: 'narrative',
        label: 'Narrative (Current vs Optimized)',
        hint: 'Current/optimized state commentary plus key takeaway.',
        kind: 'narrative',
      },
      {
        key: 'rubric',
        label: 'Rubric',
        hint: 'Structured rubric notes from the AI analysis.',
        kind: 'titled',
      },
      {
        key: 'formTable',
        label: 'Signup Form Inventory Table',
        hint: 'All signup forms pulled from Klaviyo for this audit.',
        kind: 'titled-with-subtitle',
      },
    ],
  },
  campaigns: {
    defaults: DEFAULT_CAMPAIGNS_SECTION,
    blocks: [
      {
        key: 'narrative',
        label: 'Narrative (Current vs Optimized)',
        hint: 'Current/optimized state commentary plus key takeaway.',
        kind: 'narrative',
      },
      {
        key: 'rubric',
        label: 'Rubric',
        hint: 'Structured rubric notes from the AI analysis.',
        kind: 'titled',
      },
      {
        key: 'campaignTable',
        label: 'Campaign Inventory Table',
        hint: 'All campaigns pulled from Klaviyo for this audit.',
        kind: 'titled-with-subtitle',
      },
    ],
  },
  email_design: {
    defaults: DEFAULT_EMAIL_DESIGN_SECTION,
    blocks: [
      {
        key: 'comparison',
        label: 'Email Design Comparison',
        hint: 'Side-by-side comparison of a recent campaign email and an ECD benchmark.',
        kind: 'titled-with-subtitle',
      },
    ],
  },
};

function writeGenericConfigPatch(
  base: Record<string, unknown> | null | undefined,
  sectionKey: string,
  patch: { hidden?: boolean; sectionTitle?: string; sectionNumber?: string },
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const existing =
    root[sectionKey] && typeof root[sectionKey] === 'object' && !Array.isArray(root[sectionKey])
      ? (root[sectionKey] as Record<string, unknown>)
      : {};
  const merged = { ...existing, ...patch };
  return { ...root, [sectionKey]: merged };
}

function writeGenericBlockPatch(
  base: Record<string, unknown> | null | undefined,
  sectionKey: string,
  blockKey: string,
  blockPatch: Record<string, unknown>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const existing =
    root[sectionKey] && typeof root[sectionKey] === 'object' && !Array.isArray(root[sectionKey])
      ? (root[sectionKey] as Record<string, unknown>)
      : {};
  const prevBlocks =
    existing.blocks && typeof existing.blocks === 'object' && !Array.isArray(existing.blocks)
      ? (existing.blocks as Record<string, unknown>)
      : {};
  const prevBlock =
    prevBlocks[blockKey] && typeof prevBlocks[blockKey] === 'object' && !Array.isArray(prevBlocks[blockKey])
      ? (prevBlocks[blockKey] as Record<string, unknown>)
      : {};
  const mergedBlock = { ...prevBlock, ...blockPatch };
  const mergedBlocks = { ...prevBlocks, [blockKey]: mergedBlock };
  return { ...root, [sectionKey]: { ...existing, blocks: mergedBlocks } };
}

const RUBRIC_FIELDS: Record<string, { path: string[]; label: string; placeholder?: string; rows?: number }[]> = {
  segmentation: [
    { path: ['segmentation', 'benchmark_architecture_note'], label: 'ECD benchmark note', rows: 4 },
  ],
  campaigns: [
    { path: ['campaigns', 'send_frequency_consistency'], label: 'Cadence', rows: 3 },
    { path: ['campaigns', 'segmented_vs_blast_note'], label: 'Targeting quality', rows: 3 },
    { path: ['campaigns', 'subject_preview_hygiene_note'], label: 'Subject / preview hygiene', rows: 3 },
    { path: ['campaigns', 'campaign_type_mix_note'], label: 'Campaign type mix', rows: 3 },
  ],
  signup_forms: [
    { path: ['signup_forms', 'offer_note'], label: 'Offer quality', rows: 3 },
    { path: ['signup_forms', 'mobile_optimization_note'], label: 'Mobile optimization', rows: 3 },
    { path: ['signup_forms', 'benchmark_conversion_note'], label: 'Benchmark conversion', rows: 3 },
  ],
};

function getAtPath(obj: Record<string, unknown> | null | undefined, path: string[]): unknown {
  if (!obj) return undefined;
  let cursor: unknown = obj;
  for (const key of path) {
    if (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
      cursor = (cursor as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function setAtPath(
  obj: Record<string, unknown> | null | undefined,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(obj ?? {}) };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const existing = cursor[key];
    const child =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[key] = child;
    cursor = child as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return next;
}

function writeFlowsConfigPatch(
  base: Record<string, unknown> | null | undefined,
  patch: Partial<FlowsSectionConfig>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const flowsRaw = (root.flows && typeof root.flows === 'object' && !Array.isArray(root.flows))
    ? (root.flows as Partial<FlowsSectionConfig>)
    : {};
  const mergedBlocks = {
    ...(flowsRaw.blocks ?? {}),
    ...(patch.blocks ?? {}),
  };
  const merged: Partial<FlowsSectionConfig> = {
    ...flowsRaw,
    ...patch,
    ...(patch.blocks !== undefined ? { blocks: mergedBlocks } : {}),
  };
  return { ...root, flows: merged };
}

function writeFlowsBlockPatch<K extends FlowsBlockKey>(
  base: Record<string, unknown> | null | undefined,
  block: K,
  blockPatch: NonNullable<FlowsSectionConfig['blocks'][K]>,
): Record<string, unknown> {
  const root = (base ?? {}) as Record<string, unknown>;
  const flowsRaw = (root.flows && typeof root.flows === 'object' && !Array.isArray(root.flows))
    ? (root.flows as Partial<FlowsSectionConfig>)
    : {};
  const prevBlocks = (flowsRaw.blocks ?? {}) as NonNullable<FlowsSectionConfig['blocks']>;
  const prevBlock = prevBlocks[block] ?? {};
  const mergedBlock = { ...prevBlock, ...blockPatch };
  const mergedBlocks = { ...prevBlocks, [block]: mergedBlock };
  return { ...root, flows: { ...flowsRaw, blocks: mergedBlocks } };
}

export default function AuditSectionEditor({
  section,
  onUpdate,
}: AuditSectionEditorProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('content');
  const didSeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      section.ai_findings &&
      !section.human_edited_findings &&
      didSeedRef.current !== section.id
    ) {
      didSeedRef.current = section.id;
      const stripped = section.ai_findings.replace(/\*\*(.+?)\*\*/g, '$1');
      onUpdate({ human_edited_findings: stripped });
    }
  }, [section.id, section.ai_findings, section.human_edited_findings]);

  const isFlows = section.section_key === 'flows';
  const rubricKeys = RUBRIC_FIELDS[section.section_key];
  const hasCoreFlowsMatrix = isFlows &&
    Array.isArray(((section.section_details as Record<string, unknown> | null | undefined)?.flows as Record<string, unknown> | undefined)?.core_flows);
  const showRubricTab = Boolean(rubricKeys?.length) || hasCoreFlowsMatrix;
  const showBenchmarksTab = isFlows;

  const tabs: { key: TabKey; label: string }[] = useMemo(() => {
    const t: { key: TabKey; label: string }[] = [
      { key: 'content', label: 'Content' },
      { key: 'layout', label: 'Layout' },
    ];
    if (showBenchmarksTab) t.push({ key: 'benchmarks', label: 'Benchmarks' });
    if (showRubricTab) t.push({ key: 'rubric', label: 'Rubric' });
    return t;
  }, [showBenchmarksTab, showRubricTab]);

  useEffect(() => {
    if (!tabs.find(t => t.key === activeTab)) setActiveTab('content');
  }, [tabs, activeTab]);

  const sectionConfig = (section.section_config as Record<string, unknown> | null | undefined) ?? {};
  const flowsRaw = extractFlowsRawConfig(sectionConfig);
  const resolvedFlows = resolveFlowsConfig(flowsRaw);
  const genericRaw = (() => {
    const bucket = (sectionConfig as Record<string, unknown>)[section.section_key];
    return bucket && typeof bucket === 'object' && !Array.isArray(bucket)
      ? (bucket as Record<string, unknown>)
      : undefined;
  })();
  const sectionHidden = isFlows
    ? Boolean(flowsRaw?.hidden)
    : Boolean((genericRaw as { hidden?: boolean } | undefined)?.hidden);

  const onSetFlowsSectionHidden = (hidden: boolean) => {
    onUpdate({ section_config: writeFlowsConfigPatch(sectionConfig, { hidden }) });
  };

  const onSetGenericSectionHidden = (hidden: boolean) => {
    onUpdate({ section_config: writeGenericConfigPatch(sectionConfig, section.section_key, { hidden }) });
  };

  return (
    <div className="bg-white rounded-xl card-shadow animate-slide-up">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900">
            {SECTION_LABELS[section.section_key] || section.section_key}
          </h3>
          <StatusBadge status={section.status} />
          {(sectionHidden || (isFlows && resolvedFlows.hidden)) && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              Hidden in report
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {section.revenue_opportunity > 0 && (
            <RevenueOpportunityCard amount={section.revenue_opportunity} compact />
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-50">
          <div className="flex items-center gap-1 px-6 pt-3 border-b border-gray-100 overflow-x-auto overflow-y-hidden">
            {tabs.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors -mb-px ${
                  activeTab === t.key
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="px-6 pb-6 pt-5 space-y-6">
            {activeTab === 'content' && (
              <ContentTab section={section} onUpdate={onUpdate} />
            )}
            {activeTab === 'layout' && (
              <LayoutTab
                section={section}
                onUpdate={onUpdate}
                sectionConfig={sectionConfig}
                sectionHidden={sectionHidden}
                isFlows={isFlows}
                resolvedFlows={resolvedFlows}
                genericRaw={genericRaw}
                onSetFlowsSectionHidden={onSetFlowsSectionHidden}
                onSetGenericSectionHidden={onSetGenericSectionHidden}
              />
            )}
            {activeTab === 'benchmarks' && isFlows && (
              <BenchmarksTab
                sectionConfig={sectionConfig}
                flowsRaw={flowsRaw}
                resolvedFlows={resolvedFlows}
                onUpdate={onUpdate}
              />
            )}
            {activeTab === 'rubric' && (
              <RubricTab section={section} onUpdate={onUpdate} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ContentTab({ section, onUpdate }: AuditSectionEditorProps) {
  return (
    <>
      {section.section_key !== 'flows' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Key Takeaway
          </label>
          <SimpleRichEditor
            value={section.human_edited_findings}
            onChange={v => onUpdate({ human_edited_findings: v })}
            rows={3}
            placeholder="Edit or refine the AI-generated key takeaway..."
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
          Opportunity Summary
        </label>
        <SimpleRichEditor
          value={section.summary_text}
          onChange={v => onUpdate({ summary_text: v })}
          rows={2}
          placeholder="Brief summary of this section's main revenue opportunity..."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
            Current State Title
          </label>
          <input
            type="text"
            value={section.current_state_title ?? ''}
            onChange={e => onUpdate({ current_state_title: e.target.value })}
            placeholder="Current State"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
          <SimpleRichEditor
            value={section.current_state_notes ?? ''}
            onChange={v => onUpdate({ current_state_notes: v })}
            rows={4}
            placeholder="What's broken or underperforming today..."
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
            Optimized State Title
          </label>
          <input
            type="text"
            value={section.optimized_state_title ?? ''}
            onChange={e => onUpdate({ optimized_state_title: e.target.value })}
            placeholder="Optimized State"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
          <SimpleRichEditor
            value={section.optimized_notes ?? ''}
            onChange={v => onUpdate({ optimized_notes: v })}
            rows={4}
            placeholder="What the optimized version looks like..."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Revenue Opportunity ($/mo)
          </label>
          <input
            type="number"
            value={section.revenue_opportunity}
            onChange={e => onUpdate({ revenue_opportunity: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Confidence
          </label>
          <Select value={section.confidence} onValueChange={v => onUpdate({ confidence: v as AuditSection['confidence'] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CONFIDENCE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}><SelectItemText>{label}</SelectItemText></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            Status
          </label>
          <div className="flex items-center gap-2">
            {(['draft', 'approved'] as const).map(s => (
              <button
                key={s}
                onClick={() => onUpdate({ status: s })}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  section.status === s
                    ? s === 'approved'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-600 text-white'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {section.status === s && <Check className="w-3 h-3" />}
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50">
      <div className="min-w-0 flex-1 pr-2">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-brand-primary' : 'bg-gray-200'}`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function LayoutTab({
  section,
  onUpdate,
  sectionConfig,
  sectionHidden,
  isFlows,
  resolvedFlows,
  genericRaw,
  onSetFlowsSectionHidden,
  onSetGenericSectionHidden,
}: {
  section: AuditSection;
  onUpdate: (updates: Partial<AuditSection>) => void;
  sectionConfig: Record<string, unknown>;
  sectionHidden: boolean;
  isFlows: boolean;
  resolvedFlows: FlowsSectionConfig;
  genericRaw: Record<string, unknown> | undefined;
  onSetFlowsSectionHidden: (hidden: boolean) => void;
  onSetGenericSectionHidden: (hidden: boolean) => void;
}) {
  const genericDescriptor = GENERIC_SECTION_REGISTRY[section.section_key];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Whole section</p>
        <ToggleRow
          label={`Hide entire "${SECTION_LABELS[section.section_key] || section.section_key}" section from the public report`}
          hint="The section, its nav item, and all blocks are skipped. Later sections renumber automatically."
          checked={sectionHidden}
          onChange={v => (isFlows ? onSetFlowsSectionHidden(v) : onSetGenericSectionHidden(v))}
        />
      </div>

      {isFlows ? (
        <div className="rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Flows section layout</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Section title</label>
              <input
                type="text"
                value={resolvedFlows.sectionTitle ?? ''}
                onChange={e => onUpdate({
                  section_config: writeFlowsConfigPatch(sectionConfig, { sectionTitle: e.target.value || undefined }),
                })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Section number</label>
              <input
                type="text"
                value={resolvedFlows.sectionNumber ?? ''}
                onChange={e => onUpdate({
                  section_config: writeFlowsConfigPatch(sectionConfig, { sectionNumber: e.target.value || undefined }),
                })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Blocks</p>
          <div className="space-y-2">
            {FLOWS_BLOCK_ORDER.map(({ key, label, hint }) => {
              const blockCfg = (resolvedFlows.blocks?.[key] ?? {}) as Record<string, unknown>;
              const hidden = Boolean((blockCfg as { hidden?: boolean }).hidden);
              const currentTitle = (blockCfg as { title?: string; currentTitle?: string }).title
                ?? (blockCfg as { currentTitle?: string }).currentTitle
                ?? '';
              const showTitleField = key !== 'narrative';
              return (
                <div key={key} className="rounded-lg border border-gray-100">
                  <ToggleRow
                    label={label}
                    hint={hint}
                    checked={!hidden}
                    onChange={v => onUpdate({
                      section_config: writeFlowsBlockPatch(sectionConfig, key, { hidden: !v } as never),
                    })}
                  />
                  {!hidden && (
                    <div className="px-3 pb-3 space-y-2">
                      {showTitleField && (
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">Block title</label>
                          <input
                            type="text"
                            value={currentTitle}
                            placeholder={
                              key === 'healthScore' ? DEFAULT_FLOWS_SECTION.blocks.healthScore!.title :
                              key === 'revenueBreakdown' ? DEFAULT_FLOWS_SECTION.blocks.revenueBreakdown!.title :
                              key === 'flowTable' ? DEFAULT_FLOWS_SECTION.blocks.flowTable!.title :
                              key === 'inventoryTable' ? DEFAULT_FLOWS_SECTION.blocks.inventoryTable!.title :
                              key === 'rubric' ? DEFAULT_FLOWS_SECTION.blocks.rubric!.title : ''
                            }
                            onChange={e => onUpdate({
                              section_config: writeFlowsBlockPatch(sectionConfig, key, { title: e.target.value || undefined } as never),
                            })}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          />
                        </div>
                      )}
                      {key === 'narrative' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Current-state heading</label>
                            <input
                              type="text"
                              value={(blockCfg as { currentTitle?: string }).currentTitle ?? ''}
                              placeholder={DEFAULT_FLOWS_SECTION.blocks.narrative!.currentTitle}
                              onChange={e => onUpdate({
                                section_config: writeFlowsBlockPatch(sectionConfig, key, { currentTitle: e.target.value || undefined } as never),
                              })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Optimized-state heading</label>
                            <input
                              type="text"
                              value={(blockCfg as { optimizedTitle?: string }).optimizedTitle ?? ''}
                              placeholder={DEFAULT_FLOWS_SECTION.blocks.narrative!.optimizedTitle}
                              onChange={e => onUpdate({
                                section_config: writeFlowsBlockPatch(sectionConfig, key, { optimizedTitle: e.target.value || undefined } as never),
                              })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                        </div>
                      )}
                      {key === 'healthScore' && (
                        <div>
                          <label className="block text-[11px] font-medium text-gray-500 mb-1">Subtitle</label>
                          <input
                            type="text"
                            value={(blockCfg as { subtitle?: string }).subtitle ?? ''}
                            onChange={e => onUpdate({
                              section_config: writeFlowsBlockPatch(sectionConfig, key, { subtitle: e.target.value || undefined } as never),
                            })}
                            className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          />
                        </div>
                      )}
                      {key === 'flowTable' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Subtitle override</label>
                            <input
                              type="text"
                              value={(blockCfg as { subtitleOverride?: string }).subtitleOverride ?? ''}
                              placeholder="Leave blank to compute from data"
                              onChange={e => onUpdate({
                                section_config: writeFlowsBlockPatch(sectionConfig, key, { subtitleOverride: e.target.value || undefined } as never),
                              })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-gray-500 mb-1">Default visible rows</label>
                            <input
                              type="number"
                              min={1}
                              value={(blockCfg as { defaultVisibleRows?: number }).defaultVisibleRows ?? DEFAULT_FLOWS_VISIBLE_ROWS}
                              onChange={e => onUpdate({
                                section_config: writeFlowsBlockPatch(sectionConfig, key, { defaultVisibleRows: Number(e.target.value) || DEFAULT_FLOWS_VISIBLE_ROWS } as never),
                              })}
                              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : genericDescriptor ? (
        <GenericLayoutPanel
          sectionKey={section.section_key}
          descriptor={genericDescriptor}
          sectionConfig={sectionConfig}
          genericRaw={genericRaw}
          onUpdate={onUpdate}
        />
      ) : (
        <p className="text-sm text-gray-500 italic">
          Per-block layout overrides are not available for this section yet.
        </p>
      )}
    </div>
  );
}

function GenericLayoutPanel({
  sectionKey,
  descriptor,
  sectionConfig,
  genericRaw,
  onUpdate,
}: {
  sectionKey: string;
  descriptor: GenericSectionDescriptor;
  sectionConfig: Record<string, unknown>;
  genericRaw: Record<string, unknown> | undefined;
  onUpdate: (updates: Partial<AuditSection>) => void;
}) {
  const sectionTitle = (genericRaw as { sectionTitle?: string } | undefined)?.sectionTitle ?? descriptor.defaults.sectionTitle ?? '';
  const sectionNumber = (genericRaw as { sectionNumber?: string } | undefined)?.sectionNumber ?? descriptor.defaults.sectionNumber ?? '';
  const blocksRaw =
    genericRaw?.blocks && typeof genericRaw.blocks === 'object' && !Array.isArray(genericRaw.blocks)
      ? (genericRaw.blocks as Record<string, Record<string, unknown>>)
      : {};

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {SECTION_LABELS[sectionKey] || sectionKey} section layout
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Section title</label>
          <input
            type="text"
            value={sectionTitle}
            placeholder={descriptor.defaults.sectionTitle ?? ''}
            onChange={e =>
              onUpdate({
                section_config: writeGenericConfigPatch(sectionConfig, sectionKey, {
                  sectionTitle: e.target.value || undefined,
                }),
              })
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Section number</label>
          <input
            type="text"
            value={sectionNumber}
            placeholder={descriptor.defaults.sectionNumber ?? ''}
            onChange={e =>
              onUpdate({
                section_config: writeGenericConfigPatch(sectionConfig, sectionKey, {
                  sectionNumber: e.target.value || undefined,
                }),
              })
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
          />
        </div>
      </div>

      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Blocks</p>
      <div className="space-y-2">
        {descriptor.blocks.map(block => {
          const blockCfgRaw = (blocksRaw[block.key] ?? {}) as Record<string, unknown>;
          const defaultBlock =
            (descriptor.defaults.blocks[block.key] ?? {}) as Record<string, unknown>;
          const blockCfg = { ...defaultBlock, ...blockCfgRaw } as Record<string, unknown>;
          const hidden = Boolean(blockCfg.hidden);
          const currentTitle = (blockCfg.title as string | undefined) ?? '';
          const currentSubtitle = (blockCfg.subtitle as string | undefined) ?? '';
          const currentNarrativeA = (blockCfg.currentTitle as string | undefined) ?? '';
          const currentNarrativeB = (blockCfg.optimizedTitle as string | undefined) ?? '';
          return (
            <div key={block.key} className="rounded-lg border border-gray-100">
              <ToggleRow
                label={block.label}
                hint={block.hint}
                checked={!hidden}
                onChange={v =>
                  onUpdate({
                    section_config: writeGenericBlockPatch(sectionConfig, sectionKey, block.key, {
                      hidden: !v,
                    }),
                  })
                }
              />
              {!hidden && (
                <div className="px-3 pb-3 space-y-2">
                  {block.kind === 'narrative' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">
                          Current-state heading
                        </label>
                        <input
                          type="text"
                          value={currentNarrativeA}
                          onChange={e =>
                            onUpdate({
                              section_config: writeGenericBlockPatch(sectionConfig, sectionKey, block.key, {
                                currentTitle: e.target.value || undefined,
                              }),
                            })
                          }
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">
                          Optimized-state heading
                        </label>
                        <input
                          type="text"
                          value={currentNarrativeB}
                          onChange={e =>
                            onUpdate({
                              section_config: writeGenericBlockPatch(sectionConfig, sectionKey, block.key, {
                                optimizedTitle: e.target.value || undefined,
                              }),
                            })
                          }
                          className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                        />
                      </div>
                    </div>
                  )}
                  {(block.kind === 'titled' || block.kind === 'titled-with-subtitle') && (
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Block title</label>
                      <input
                        type="text"
                        value={currentTitle}
                        onChange={e =>
                          onUpdate({
                            section_config: writeGenericBlockPatch(sectionConfig, sectionKey, block.key, {
                              title: e.target.value || undefined,
                            }),
                          })
                        }
                        className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                      />
                    </div>
                  )}
                  {block.kind === 'titled-with-subtitle' && (
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Subtitle</label>
                      <input
                        type="text"
                        value={currentSubtitle}
                        onChange={e =>
                          onUpdate({
                            section_config: writeGenericBlockPatch(sectionConfig, sectionKey, block.key, {
                              subtitle: e.target.value || undefined,
                            }),
                          })
                        }
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
  );
}

function BenchmarksTab({
  sectionConfig,
  flowsRaw,
  resolvedFlows,
  onUpdate,
}: {
  sectionConfig: Record<string, unknown>;
  flowsRaw: Partial<FlowsSectionConfig> | undefined;
  resolvedFlows: FlowsSectionConfig;
  onUpdate: (updates: Partial<AuditSection>) => void;
}) {
  const benchmarks = resolvedFlows.blocks.healthScore?.benchmarks ?? {};
  const tiers = benchmarks.revenueTiers ?? [];

  const writeBenchmarks = (patch: Partial<typeof benchmarks>) => {
    onUpdate({
      section_config: writeFlowsBlockPatch(sectionConfig, 'healthScore', {
        benchmarks: { ...benchmarks, ...patch },
      } as never),
    });
  };

  const resetBenchmarks = () => {
    onUpdate({
      section_config: writeFlowsBlockPatch(sectionConfig, 'healthScore', {
        benchmarks: undefined,
      } as never),
    });
  };

  const customized = Boolean(flowsRaw?.blocks?.healthScore?.benchmarks);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Health score benchmarks</h4>
          <p className="text-xs text-gray-500 mt-0.5">
            Tune the thresholds used by the "Overall Flow Health Score" and the rating dot colors in the performance table.
          </p>
        </div>
        {customized && (
          <button
            type="button"
            onClick={resetBenchmarks}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BenchmarkNumberField
          label="Open rate – low (good ≥ this)"
          suffix="%"
          value={benchmarks.openRateLow ?? DEFAULT_FLOWS_HEALTH_BENCHMARKS.openRateLow}
          onChange={v => writeBenchmarks({ openRateLow: v })}
        />
        <BenchmarkNumberField
          label="Open rate – high"
          suffix="%"
          value={benchmarks.openRateHigh ?? DEFAULT_FLOWS_HEALTH_BENCHMARKS.openRateHigh}
          onChange={v => writeBenchmarks({ openRateHigh: v })}
        />
        <BenchmarkNumberField
          label="Click rate – low"
          suffix="%"
          value={benchmarks.clickRateLow ?? DEFAULT_FLOWS_HEALTH_BENCHMARKS.clickRateLow}
          onChange={v => writeBenchmarks({ clickRateLow: v })}
        />
        <BenchmarkNumberField
          label="Click rate – high"
          suffix="%"
          value={benchmarks.clickRateHigh ?? DEFAULT_FLOWS_HEALTH_BENCHMARKS.clickRateHigh}
          onChange={v => writeBenchmarks({ clickRateHigh: v })}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-900">Revenue tiers</h4>
          <button
            type="button"
            onClick={() => writeBenchmarks({ revenueTiers: [...tiers, { min: 0, label: 'New tier' }] })}
            className="text-xs font-semibold text-brand-primary hover:underline"
          >
            + Add tier
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          Used to describe how annualized flow revenue compares to industry expectations.
        </p>
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-32">
                <input
                  type="number"
                  value={tier.min}
                  onChange={e => {
                    const next = tiers.slice();
                    next[i] = { ...tier, min: Number(e.target.value) };
                    writeBenchmarks({ revenueTiers: next });
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded-md text-sm"
                  placeholder="Min ($)"
                />
              </div>
              <input
                type="text"
                value={tier.label}
                onChange={e => {
                  const next = tiers.slice();
                  next[i] = { ...tier, label: e.target.value };
                  writeBenchmarks({ revenueTiers: next });
                }}
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-md text-sm"
                placeholder="Label"
              />
              <button
                type="button"
                onClick={() => writeBenchmarks({ revenueTiers: tiers.filter((_, j) => j !== i) })}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BenchmarkNumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const displayPct = Math.round((value ?? 0) * 10000) / 100;
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.1"
          value={displayPct}
          onChange={e => onChange(Number(e.target.value) / 100)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
        />
        {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

function RubricTab({
  section,
  onUpdate,
}: {
  section: AuditSection;
  onUpdate: (updates: Partial<AuditSection>) => void;
}) {
  const details = (section.section_details ?? null) as Record<string, unknown> | null;
  const fields = RUBRIC_FIELDS[section.section_key] ?? [];
  const isFlows = section.section_key === 'flows';

  const write = (path: string[], value: unknown) => {
    const next = setAtPath(details, path, value);
    onUpdate({ section_details: next });
  };

  if (isFlows) {
    const flows = (details?.flows ?? null) as Record<string, unknown> | null;
    const coreFlows = Array.isArray(flows?.core_flows)
      ? (flows!.core_flows as Array<Record<string, unknown>>)
      : [];
    const flowNameOptions = CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION;
    const nextAvailableFlowName = () => {
      const used = new Set(coreFlows.map(row => String(row.flow_name ?? '')));
      return flowNameOptions.find(name => !used.has(name)) ?? flowNameOptions[0];
    };
    return (
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Edit the Core Flows Matrix rows that render under the Flows section. Flow names use predefined ECD labels — reference matched Klaviyo flows in the structure notes.
        </p>
        <div className="space-y-2">
          {coreFlows.map((row, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={String(row.flow_name ?? flowNameOptions[0])}
                  onChange={e => {
                    const next = coreFlows.slice();
                    next[i] = { ...row, flow_name: e.target.value };
                    write(['flows', 'core_flows'], next);
                  }}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
                >
                  {flowNameOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const next = coreFlows.filter((_, j) => j !== i);
                    write(['flows', 'core_flows'], next);
                  }}
                  className="text-xs text-gray-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
                  <span className="text-xs text-gray-700">Present</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(row.present)}
                    onClick={() => {
                      const next = coreFlows.slice();
                      next[i] = { ...row, present: !Boolean(row.present) };
                      write(['flows', 'core_flows'], next);
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${Boolean(row.present) ? 'bg-brand-primary' : 'bg-gray-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${Boolean(row.present) ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5">
                  <span className="text-xs text-gray-700">Live</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(row.live)}
                    onClick={() => {
                      const next = coreFlows.slice();
                      next[i] = { ...row, live: !Boolean(row.live) };
                      write(['flows', 'core_flows'], next);
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${Boolean(row.live) ? 'bg-brand-primary' : 'bg-gray-200'}`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${Boolean(row.live) ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <span>Emails</span>
                  <input
                    type="number"
                    value={typeof row.email_count === 'number' ? row.email_count : ''}
                    onChange={e => {
                      const next = coreFlows.slice();
                      const num = e.target.value === '' ? null : Number(e.target.value);
                      next[i] = { ...row, email_count: num };
                      write(['flows', 'core_flows'], next);
                    }}
                    className="w-16 px-2 py-1 border border-gray-200 rounded text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Current structure (short phrase)</label>
                  <SimpleRichEditor
                    value={String(row.current_structure_note ?? '')}
                    onChange={v => {
                      const next = coreFlows.slice();
                      next[i] = { ...row, current_structure_note: v };
                      write(['flows', 'core_flows'], next);
                    }}
                    rows={2}
                    placeholder="e.g. 3 emails, no SMS, weak CTA on email 2"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Recommended structure (short phrase)</label>
                  <SimpleRichEditor
                    value={String(row.recommended_structure ?? '')}
                    onChange={v => {
                      const next = coreFlows.slice();
                      next[i] = { ...row, recommended_structure: v };
                      write(['flows', 'core_flows'], next);
                    }}
                    rows={2}
                    placeholder="e.g. 4 emails + SMS, offer in email 3"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = [...coreFlows, {
                flow_name: nextAvailableFlowName(),
                present: false,
                live: false,
                email_count: null,
                current_structure_note: '',
                recommended_structure: '',
              }];
              write(['flows', 'core_flows'], next);
            }}
            className="text-xs font-semibold text-brand-primary hover:underline"
          >
            + Add row
          </button>
        </div>
      </div>
    );
  }

  if (!fields.length) {
    return (
      <p className="text-sm text-gray-500 italic">
        This section doesn't have a structured rubric yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map(f => (
        <div key={f.path.join('.')}>
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
            {f.label}
          </label>
          <SimpleRichEditor
            value={String(getAtPath(details, f.path) ?? '')}
            onChange={v => write(f.path, v)}
            rows={f.rows ?? 3}
            placeholder={f.placeholder}
          />
        </div>
      ))}
    </div>
  );
}
