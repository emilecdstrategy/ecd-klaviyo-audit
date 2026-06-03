import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Audit, AuditSection } from '../../../lib/types';
import { updateAudit, updateAuditSection } from '../../../lib/db';
import { scheduleSavedToast, useToast } from '../../ui/Toast';
import type { RevenueOpportunityAddOnItem } from '../../../lib/types';
import { computeAuditTotalRevenueOpportunity } from '../../../lib/revenue-calculator';
import { normalizeCoreFlowsMatrix, sanitizeStructureNote, type CoreFlowRow } from '../../../lib/core-flows-matrix';
import { getExecutiveFindingsForEdit } from '../../../lib/findings-normalize';
import { repairEntityMarkers } from '../../../lib/entity-tags';
import { writeFlowsConfigPatch, writeGenericConfigPatch, writeGenericBlockPatch, writeFlowsBlockPatch, writeExecutiveBlockPatch, writeRevenueBlockPatch } from '../../../lib/report-config/section-hide';

type LayoutSectionKey = 'executive_summary' | 'revenue_summary' | 'deliverability_snapshot' | 'attribution_model';

export type TimelinePhase = {
  phase: string;
  timeframe: string;
  label: string;
  items: string[];
};

export type ExecutivePayload = {
  text?: string;
  findings?: string[];
  concerns?: string[];
  strengths?: string[];
  findingsHidden?: boolean[];
  strengthsHidden?: boolean[];
  timelineHidden?: boolean[];
  timeline?: TimelinePhase[];
};

function parseExecutiveSummary(raw: string): ExecutivePayload {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ExecutivePayload;
    }
  } catch {
    /* plain text */
  }
  return { text: raw };
}

function materializeFindings(payload: ExecutivePayload): string[] {
  return getExecutiveFindingsForEdit(payload.findings, payload.concerns);
}

function materializeFindingsHidden(payload: ExecutivePayload, length: number): boolean[] {
  const hidden = [...(payload.findingsHidden ?? [])];
  while (hidden.length < length) hidden.push(false);
  return hidden.slice(0, length);
}

function serializeExecutive(payload: ExecutivePayload, fallbackRaw: string): string {
  if (
    payload.findings?.length ||
    payload.strengths?.length ||
    payload.findingsHidden?.some(Boolean) ||
    payload.strengthsHidden?.some(Boolean) ||
    payload.timelineHidden?.some(Boolean) ||
    payload.timeline?.length ||
    (payload.text && payload.text !== fallbackRaw)
  ) {
    return JSON.stringify(payload);
  }
  return payload.text ?? fallbackRaw;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type ReportEditContextValue = {
  editMode: boolean;
  saveStatus: SaveStatus;
  updateFinding: (index: number, value: string) => void;
  addFinding: () => void;
  removeFinding: (index: number) => void;
  updateStrength: (index: number, value: string) => void;
  updateExecText: (value: string) => void;
  updateSectionField: (
    sectionKey: string,
    field: 'current_state_notes' | 'optimized_state_notes' | 'current_state_title' | 'optimized_state_title' | 'human_edited_findings' | 'summary_text',
    value: string,
  ) => void;
  updateLayoutTitle: (
    layoutKey: LayoutSectionKey,
    field: 'sectionTitle' | 'sectionNumber',
    value: string,
  ) => void;
  updateBlockTitle: (
    layoutKey: 'executive_summary' | 'revenue_summary',
    blockKey: string,
    field: 'title' | 'subtitle',
    value: string,
  ) => void;
  updateTimelinePhase: (phaseIndex: number, field: keyof TimelinePhase, value: string | string[]) => void;
  updateTimelineItem: (phaseIndex: number, itemIndex: number, value: string) => void;
  updateAddOnField: (
    itemKey: string,
    field: 'name' | 'description' | 'details_url',
    value: string,
  ) => void;
  updateAddOnRevenue: (itemKey: string, value: number) => void;
  updateAddOnPrice: (
    itemKey: string,
    field: 'one_time_price' | 'one_time_label' | 'monthly_price' | 'monthly_label',
    value: number | string | null,
  ) => void;
  updateAddOnContent: (itemKey: string, value: string) => void;
  updateAddOnImage: (itemKey: string, value: string | null) => void;
  toggleAddOnHighlighted: (itemKey: string, highlighted: boolean) => void;
  updateAttributionScreenshot: (value: string | null) => void;
  updateSectionRevenueOpportunity: (sectionKey: string, value: number) => void;
  toggleLayoutSectionHidden: (layoutKey: LayoutSectionKey, hidden: boolean) => void;
  toggleAuditSectionHidden: (sectionKey: string, hidden: boolean) => void;
  toggleExecutiveBlockHidden: (blockKey: string, hidden: boolean) => void;
  toggleRevenueBlockHidden: (blockKey: string, hidden: boolean) => void;
  toggleSectionBlockHidden: (sectionKey: string, blockKey: string, hidden: boolean) => void;
  toggleFlowsBlockHidden: (blockKey: string, hidden: boolean) => void;
  toggleFindingHidden: (index: number, hidden: boolean) => void;
  toggleStrengthHidden: (index: number, hidden: boolean) => void;
  toggleTimelinePhaseHidden: (index: number, hidden: boolean) => void;
  updateSectionBlockField: (
    sectionKey: string,
    blockKey: string,
    field: 'title' | 'subtitle' | 'currentTitle' | 'optimizedTitle',
    value: string,
  ) => void;
  updateSectionDetailField: (sectionKey: string, path: string[], value: string) => void;
  updateCoreFlowMatrixNote: (
    sectionKey: string,
    rowIndex: number,
    field: 'current_structure_note' | 'recommended_structure',
    value: string,
  ) => void;
  patchSectionBlock: (sectionKey: string, blockKey: string, patch: Record<string, unknown>) => void;
};

const ReportEditContext = createContext<ReportEditContextValue>({
  editMode: false,
  saveStatus: 'idle',
  updateFinding: () => {},
  updateStrength: () => {},
  updateExecText: () => {},
  updateSectionField: () => {},
  updateLayoutTitle: () => {},
  updateBlockTitle: () => {},
  updateTimelinePhase: () => {},
  updateTimelineItem: () => {},
  updateAddOnField: () => {},
  updateAddOnRevenue: () => {},
  updateAddOnPrice: () => {},
  updateAddOnContent: () => {},
  updateAddOnImage: () => {},
  updateAttributionScreenshot: () => {},
  updateSectionRevenueOpportunity: () => {},
  toggleLayoutSectionHidden: () => {},
  toggleAuditSectionHidden: () => {},
  toggleExecutiveBlockHidden: () => {},
  toggleRevenueBlockHidden: () => {},
  toggleSectionBlockHidden: () => {},
  toggleFlowsBlockHidden: () => {},
  toggleFindingHidden: () => {},
  toggleStrengthHidden: () => {},
  toggleTimelinePhaseHidden: () => {},
  updateSectionBlockField: () => {},
  updateSectionDetailField: () => {},
  updateCoreFlowMatrixNote: () => {},
  patchSectionBlock: () => {},
});

export function useReportEdit() {
  return useContext(ReportEditContext);
}

export function ReportEditProvider({
  editMode,
  audit,
  sections,
  onAuditChange,
  onSectionsChange,
  children,
}: {
  editMode: boolean;
  audit: Audit;
  sections: AuditSection[];
  onAuditChange: (next: Audit) => void;
  onSectionsChange: (next: AuditSection[]) => void;
  children: ReactNode;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const timers = useRef<Record<string, number>>({});
  const toast = useToast();

  const schedule = useCallback((key: string, fn: () => Promise<void>) => {
    if (timers.current[key]) window.clearTimeout(timers.current[key]);
    setSaveStatus('saving');
    timers.current[key] = window.setTimeout(async () => {
      try {
        await fn();
        setSaveStatus('saved');
        scheduleSavedToast(toast);
        window.setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2500);
      } catch {
        setSaveStatus('error');
        toast('Could not save');
      }
    }, 800) as unknown as number;
  }, [toast]);

  const getExecPayload = useCallback(
    () => parseExecutiveSummary(audit.executive_summary || ''),
    [audit.executive_summary],
  );

  const saveExecutive = useCallback(
    (patch: Partial<ExecutivePayload>) => {
      const prev = getExecPayload();
      const nextPayload = { ...prev, ...patch };
      const serialized = serializeExecutive(nextPayload, audit.executive_summary || '');
      onAuditChange({ ...audit, executive_summary: serialized });
      schedule('executive', async () => {
        await updateAudit(audit.id, { executive_summary: serialized });
      });
    },
    [audit, getExecPayload, onAuditChange, schedule],
  );

  const updateFinding = useCallback(
    (index: number, value: string) => {
      const prev = getExecPayload();
      const findings = materializeFindings(prev);
      while (findings.length <= index) findings.push('');
      findings[index] = repairEntityMarkers(value);
      saveExecutive({
        findings,
        findingsHidden: materializeFindingsHidden(prev, findings.length),
      });
    },
    [getExecPayload, saveExecutive],
  );

  const addFinding = useCallback(() => {
    const prev = getExecPayload();
    const findings = materializeFindings(prev);
    const findingsHidden = materializeFindingsHidden(prev, findings.length);
    findings.push('');
    findingsHidden.push(false);
    saveExecutive({ findings, findingsHidden });
  }, [getExecPayload, saveExecutive]);

  const removeFinding = useCallback(
    (index: number) => {
      const prev = getExecPayload();
      let findings = materializeFindings(prev);
      let findingsHidden = materializeFindingsHidden(prev, findings.length);
      if (index < 0 || index >= findings.length) return;

      if (findings.length <= 1) {
        findings = [''];
        findingsHidden = [false];
      } else {
        findings = findings.filter((_, i) => i !== index);
        findingsHidden = findingsHidden.filter((_, i) => i !== index);
      }
      saveExecutive({ findings, findingsHidden });
    },
    [getExecPayload, saveExecutive],
  );

  const updateStrength = useCallback(
    (index: number, value: string) => {
      const prev = getExecPayload();
      const strengths = [...(prev.strengths ?? [])];
      while (strengths.length <= index) strengths.push('');
      strengths[index] = repairEntityMarkers(value);
      saveExecutive({ strengths });
    },
    [getExecPayload, saveExecutive],
  );

  const updateExecText = useCallback(
    (value: string) => saveExecutive({ text: value }),
    [saveExecutive],
  );

  const updateSectionField = useCallback(
    (
      sectionKey: string,
      field: 'current_state_notes' | 'optimized_state_notes' | 'current_state_title' | 'optimized_state_title' | 'human_edited_findings' | 'summary_text',
      value: string,
    ) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, [field]: value } : s,
      );
      onSectionsChange(nextSections);
      schedule(`section-${section.id}-${field}`, async () => {
        await updateAuditSection(section.id, { [field]: value } as Partial<AuditSection>);
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const patchLayout = useCallback(
    (layoutKey: LayoutSectionKey, patchFn: (section: Record<string, unknown>) => Record<string, unknown>) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const section = { ...((layout[layoutKey] as Record<string, unknown>) ?? {}) };
      layout[layoutKey] = patchFn(section);
      onAuditChange({ ...audit, layout });
      schedule(`layout-${layoutKey}`, async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const updateLayoutTitle = useCallback(
    (layoutKey: LayoutSectionKey, field: 'sectionTitle' | 'sectionNumber', value: string) => {
      patchLayout(layoutKey, section => ({ ...section, [field]: value || undefined }));
    },
    [patchLayout],
  );

  const updateBlockTitle = useCallback(
    (layoutKey: 'executive_summary' | 'revenue_summary', blockKey: string, field: 'title' | 'subtitle', value: string) => {
      patchLayout(layoutKey, section => {
        const blocks = { ...((section.blocks as Record<string, unknown>) ?? {}) };
        const block = { ...((blocks[blockKey] as Record<string, unknown>) ?? {}), [field]: value || undefined };
        blocks[blockKey] = block;
        return { ...section, blocks };
      });
    },
    [patchLayout],
  );

  const updateTimelinePhase = useCallback(
    (phaseIndex: number, field: keyof TimelinePhase, value: string | string[]) => {
      const prev = getExecPayload();
      const timeline = [...(prev.timeline ?? [])];
      while (timeline.length <= phaseIndex) {
        timeline.push({ phase: '', timeframe: '', label: '', items: [] });
      }
      timeline[phaseIndex] = { ...timeline[phaseIndex], [field]: value };
      saveExecutive({ timeline });
    },
    [getExecPayload, saveExecutive],
  );

  const updateTimelineItem = useCallback(
    (phaseIndex: number, itemIndex: number, value: string) => {
      const prev = getExecPayload();
      const timeline = [...(prev.timeline ?? [])];
      const phase = timeline[phaseIndex];
      if (!phase) return;
      const items = [...(phase.items ?? [])];
      while (items.length <= itemIndex) items.push('');
      items[itemIndex] = repairEntityMarkers(value);
      timeline[phaseIndex] = { ...phase, items };
      saveExecutive({ timeline });
    },
    [getExecPayload, saveExecutive],
  );

  const syncAuditTotalRevenue = useCallback(
    (nextSections: AuditSection[], baseAudit: Audit) => {
      const total = computeAuditTotalRevenueOpportunity(nextSections, baseAudit.layout);
      if (total === baseAudit.total_revenue_opportunity) return baseAudit;
      const nextAudit = { ...baseAudit, total_revenue_opportunity: total };
      onAuditChange(nextAudit);
      schedule('audit-total-revenue', async () => {
        await updateAudit(baseAudit.id, { total_revenue_opportunity: total });
      });
      return nextAudit;
    },
    [onAuditChange, schedule],
  );

  const updateSectionRevenueOpportunity = useCallback(
    (sectionKey: string, value: number) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, revenue_opportunity: value } : s,
      );
      onSectionsChange(nextSections);
      syncAuditTotalRevenue(nextSections, audit);
      schedule(`section-${section.id}-revenue_opportunity`, async () => {
        await updateAuditSection(section.id, { revenue_opportunity: value });
      });
    },
    [sections, onSectionsChange, syncAuditTotalRevenue, audit, schedule],
  );

  const updateAddOnField = useCallback(
    (itemKey: string, field: 'name' | 'description' | 'details_url', value: string) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      const nextValue = field === 'details_url' ? (value.trim() || null) : value;
      items[idx] = { ...items[idx], [field]: nextValue };
      addOns.items = items;
      blocks.addOns = addOns;
      rs.blocks = blocks;
      layout.revenue_summary = rs;
      onAuditChange({ ...audit, layout });
      schedule('layout-addons', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const updateAddOnRevenue = useCallback(
    (itemKey: string, value: number) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      items[idx] = { ...items[idx], revenue_monthly: value };
      addOns.items = items;
      blocks.addOns = addOns;
      rs.blocks = blocks;
      layout.revenue_summary = rs;
      const nextAudit = { ...audit, layout };
      const total = computeAuditTotalRevenueOpportunity(sections, layout);
      onAuditChange({ ...nextAudit, total_revenue_opportunity: total });
      schedule('layout-addons', async () => {
        await updateAudit(audit.id, {
          layout,
          ...(total !== audit.total_revenue_opportunity ? { total_revenue_opportunity: total } : {}),
        });
      });
    },
    [audit, onAuditChange, sections, schedule],
  );

  const updateAddOnPrice = useCallback(
    (
      itemKey: string,
      field: 'one_time_price' | 'one_time_label' | 'monthly_price' | 'monthly_label',
      value: number | string | null,
    ) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      const nextValue =
        field === 'one_time_label' || field === 'monthly_label'
          ? (typeof value === 'string' ? (value.trim() || null) : null)
          : (value == null || value === '' ? null : Number(value));
      items[idx] = { ...items[idx], [field]: nextValue };
      addOns.items = items;
      blocks.addOns = addOns;
      rs.blocks = blocks;
      layout.revenue_summary = rs;
      onAuditChange({ ...audit, layout });
      schedule('layout-addons', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const updateAddOnContent = useCallback(
    (itemKey: string, value: string) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      items[idx] = { ...items[idx], content: value };
      addOns.items = items;
      blocks.addOns = addOns;
      rs.blocks = blocks;
      layout.revenue_summary = rs;
      onAuditChange({ ...audit, layout });
      schedule('layout-addons', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const updateAddOnImage = useCallback(
    (itemKey: string, value: string | null) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      items[idx] = { ...items[idx], image_url: value };
      addOns.items = items;
      blocks.addOns = addOns;
      rs.blocks = blocks;
      layout.revenue_summary = rs;
      onAuditChange({ ...audit, layout });
      schedule('layout-addons', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  // Highlight toggles live in Revenue opportunities drawer only (RevenueAddOnItemsEditor).
  const toggleAddOnHighlighted = useCallback((_itemKey: string, _highlighted: boolean) => {
    /* Re-enable if report-card highlight toggle returns:
    const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
    ...
    */
  }, []);

  const updateAttributionScreenshot = useCallback(
    (value: string | null) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const section = {
        ...((layout.attribution_model as Record<string, unknown>) ?? {}),
        screenshot_url: value,
      };
      layout.attribution_model = section;
      onAuditChange({ ...audit, layout });
      schedule('layout-attribution', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const toggleLayoutSectionHidden = useCallback(
    (layoutKey: LayoutSectionKey, hidden: boolean) => {
      patchLayout(layoutKey, section => ({ ...section, hidden: hidden || undefined }));
    },
    [patchLayout],
  );

  const toggleAuditSectionHidden = useCallback(
    (sectionKey: string, hidden: boolean) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const sectionConfig = (section.section_config as Record<string, unknown> | null | undefined) ?? {};
      const nextConfig =
        sectionKey === 'flows'
          ? writeFlowsConfigPatch(sectionConfig, { hidden: hidden || undefined })
          : writeGenericConfigPatch(sectionConfig, sectionKey, { hidden: hidden || undefined });
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, section_config: nextConfig } : s,
      );
      onSectionsChange(nextSections);
      syncAuditTotalRevenue(nextSections, audit);
      schedule(`section-hidden-${section.id}`, async () => {
        await updateAuditSection(section.id, { section_config: nextConfig });
      });
    },
    [sections, onSectionsChange, schedule, syncAuditTotalRevenue, audit],
  );

  const toggleExecutiveBlockHidden = useCallback(
    (blockKey: string, hidden: boolean) => {
      const layout = writeExecutiveBlockPatch(
        (audit.layout as Record<string, unknown>) ?? {},
        blockKey,
        { hidden: hidden || undefined },
      );
      onAuditChange({ ...audit, layout });
      schedule(`layout-exec-block-${blockKey}`, async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const toggleRevenueBlockHidden = useCallback(
    (blockKey: string, hidden: boolean) => {
      const layout = writeRevenueBlockPatch(
        (audit.layout as Record<string, unknown>) ?? {},
        blockKey,
        { hidden: hidden || undefined },
      );
      onAuditChange({ ...audit, layout });
      schedule(`layout-rev-block-${blockKey}`, async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
  );

  const toggleSectionBlockHidden = useCallback(
    (sectionKey: string, blockKey: string, hidden: boolean) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const sectionConfig = (section.section_config as Record<string, unknown> | null | undefined) ?? {};
      const nextConfig =
        sectionKey === 'flows'
          ? writeFlowsBlockPatch(sectionConfig, blockKey, { hidden: hidden || undefined })
          : writeGenericBlockPatch(sectionConfig, sectionKey, blockKey, { hidden: hidden || undefined });
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, section_config: nextConfig } : s,
      );
      onSectionsChange(nextSections);
      schedule(`section-block-${section.id}-${blockKey}`, async () => {
        await updateAuditSection(section.id, { section_config: nextConfig });
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const toggleFlowsBlockHidden = useCallback(
    (blockKey: string, hidden: boolean) => toggleSectionBlockHidden('flows', blockKey, hidden),
    [toggleSectionBlockHidden],
  );

  const toggleFindingHidden = useCallback(
    (index: number, hidden: boolean) => {
      const prev = getExecPayload();
      const findingsHidden = [...(prev.findingsHidden ?? [])];
      while (findingsHidden.length <= index) findingsHidden.push(false);
      findingsHidden[index] = hidden;
      saveExecutive({ findingsHidden });
    },
    [getExecPayload, saveExecutive],
  );

  const toggleStrengthHidden = useCallback(
    (index: number, hidden: boolean) => {
      const prev = getExecPayload();
      const strengthsHidden = [...(prev.strengthsHidden ?? [])];
      while (strengthsHidden.length <= index) strengthsHidden.push(false);
      strengthsHidden[index] = hidden;
      saveExecutive({ strengthsHidden });
    },
    [getExecPayload, saveExecutive],
  );

  const toggleTimelinePhaseHidden = useCallback(
    (index: number, hidden: boolean) => {
      const prev = getExecPayload();
      const timelineHidden = [...(prev.timelineHidden ?? [])];
      while (timelineHidden.length <= index) timelineHidden.push(false);
      timelineHidden[index] = hidden;
      saveExecutive({ timelineHidden });
    },
    [getExecPayload, saveExecutive],
  );

  const patchSectionBlock = useCallback(
    (sectionKey: string, blockKey: string, patch: Record<string, unknown>) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const sectionConfig = (section.section_config as Record<string, unknown> | null | undefined) ?? {};
      const nextConfig =
        sectionKey === 'flows'
          ? writeFlowsBlockPatch(sectionConfig, blockKey, patch)
          : writeGenericBlockPatch(sectionConfig, sectionKey, blockKey, patch);
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, section_config: nextConfig } : s,
      );
      onSectionsChange(nextSections);
      schedule(`section-block-patch-${section.id}-${blockKey}`, async () => {
        await updateAuditSection(section.id, { section_config: nextConfig });
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const updateSectionBlockField = useCallback(
    (
      sectionKey: string,
      blockKey: string,
      field: 'title' | 'subtitle' | 'currentTitle' | 'optimizedTitle',
      value: string,
    ) => {
      patchSectionBlock(sectionKey, blockKey, { [field]: value || undefined });
    },
    [patchSectionBlock],
  );

  const updateSectionDetailField = useCallback(
    (sectionKey: string, path: string[], value: string) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section || path.length === 0) return;
      const raw = section.section_details;
      const details: Record<string, unknown> =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : typeof raw === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(raw);
                  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? { ...(parsed as Record<string, unknown>) }
                    : {};
                } catch {
                  return {};
                }
              })()
            : {};
      let cursor: Record<string, unknown> = details;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        const next =
          cursor[key] && typeof cursor[key] === 'object' && !Array.isArray(cursor[key])
            ? { ...(cursor[key] as Record<string, unknown>) }
            : {};
        cursor[key] = next;
        cursor = next;
      }
      cursor[path[path.length - 1]] = value;
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, section_details: details } : s,
      );
      onSectionsChange(nextSections);
      schedule(`section-detail-${section.id}-${path.join('.')}`, async () => {
        await updateAuditSection(section.id, { section_details: details });
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const updateCoreFlowMatrixNote = useCallback(
    (
      sectionKey: string,
      rowIndex: number,
      field: 'current_structure_note' | 'recommended_structure',
      value: string,
    ) => {
      const section = sections.find(s => s.section_key === sectionKey);
      if (!section) return;
      const raw = section.section_details;
      const details: Record<string, unknown> =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : typeof raw === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(raw);
                  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? { ...(parsed as Record<string, unknown>) }
                    : {};
                } catch {
                  return {};
                }
              })()
            : {};
      const flows = details.flows;
      const flowsObj =
        flows && typeof flows === 'object' && !Array.isArray(flows)
          ? { ...(flows as Record<string, unknown>) }
          : {};
      const coreFlows = Array.isArray(flowsObj.core_flows)
        ? (flowsObj.core_flows as CoreFlowRow[])
        : [];
      const normalized = normalizeCoreFlowsMatrix(coreFlows);
      if (rowIndex < 0 || rowIndex >= normalized.length) return;
      normalized[rowIndex] = {
        ...normalized[rowIndex],
        [field]: sanitizeStructureNote(value),
      };
      details.flows = { ...flowsObj, core_flows: normalized };
      const nextSections = sections.map(s =>
        s.id === section.id ? { ...s, section_details: details } : s,
      );
      onSectionsChange(nextSections);
      schedule(`core-flow-${section.id}-${rowIndex}-${field}`, async () => {
        await updateAuditSection(section.id, { section_details: details });
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const value = useMemo(
    () => ({
      editMode,
      saveStatus,
      updateFinding,
      addFinding,
      removeFinding,
      updateStrength,
      updateExecText,
      updateSectionField,
      updateLayoutTitle,
      updateBlockTitle,
      updateTimelinePhase,
      updateTimelineItem,
      updateAddOnField,
      updateAddOnRevenue,
      updateAddOnPrice,
      updateAddOnContent,
      updateAddOnImage,
      toggleAddOnHighlighted,
      updateAttributionScreenshot,
      updateSectionRevenueOpportunity,
      toggleLayoutSectionHidden,
      toggleAuditSectionHidden,
      toggleExecutiveBlockHidden,
      toggleRevenueBlockHidden,
      toggleSectionBlockHidden,
      toggleFlowsBlockHidden,
      toggleFindingHidden,
      toggleStrengthHidden,
      toggleTimelinePhaseHidden,
      updateSectionBlockField,
      updateSectionDetailField,
      updateCoreFlowMatrixNote,
      patchSectionBlock,
    }),
    [
      editMode,
      saveStatus,
      updateFinding,
      addFinding,
      removeFinding,
      updateStrength,
      updateExecText,
      updateSectionField,
      updateLayoutTitle,
      updateBlockTitle,
      updateTimelinePhase,
      updateTimelineItem,
      updateAddOnField,
      updateAddOnRevenue,
      updateAddOnPrice,
      updateAddOnContent,
      updateAddOnImage,
      toggleAddOnHighlighted,
      updateAttributionScreenshot,
      updateSectionRevenueOpportunity,
      toggleLayoutSectionHidden,
      toggleAuditSectionHidden,
      toggleExecutiveBlockHidden,
      toggleRevenueBlockHidden,
      toggleSectionBlockHidden,
      toggleFlowsBlockHidden,
      toggleFindingHidden,
      toggleStrengthHidden,
      toggleTimelinePhaseHidden,
      updateSectionBlockField,
      updateSectionDetailField,
      updateCoreFlowMatrixNote,
      patchSectionBlock,
    ],
  );

  return (
    <ReportEditContext.Provider value={value}>
      {children}
    </ReportEditContext.Provider>
  );
}

export { parseExecutiveSummary };
