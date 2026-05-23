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
import type { RevenueOpportunityAddOnItem } from '../../../lib/types';
import { writeFlowsConfigPatch, writeGenericConfigPatch } from '../../../lib/report-config/section-hide';

export type TimelinePhase = {
  phase: string;
  timeframe: string;
  label: string;
  items: string[];
};

export type ExecutivePayload = {
  text?: string;
  findings?: string[];
  strengths?: string[];
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

function serializeExecutive(payload: ExecutivePayload, fallbackRaw: string): string {
  if (
    payload.findings?.length ||
    payload.strengths?.length ||
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
  updateStrength: (index: number, value: string) => void;
  updateExecText: (value: string) => void;
  updateHeroLayout: (field: 'eyebrow' | 'headline' | 'intro', value: string) => void;
  updateSectionField: (
    sectionKey: string,
    field: 'current_state_notes' | 'optimized_state_notes' | 'current_state_title' | 'optimized_state_title' | 'human_edited_findings' | 'summary_text',
    value: string,
  ) => void;
  updateLayoutTitle: (
    layoutKey: 'executive_summary' | 'revenue_summary',
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
    field: 'name' | 'description',
    value: string,
  ) => void;
  updateAddOnBullet: (itemKey: string, bulletIndex: number, value: string) => void;
  toggleLayoutSectionHidden: (layoutKey: 'executive_summary' | 'revenue_summary', hidden: boolean) => void;
  toggleAuditSectionHidden: (sectionKey: string, hidden: boolean) => void;
};

const ReportEditContext = createContext<ReportEditContextValue>({
  editMode: false,
  saveStatus: 'idle',
  updateFinding: () => {},
  updateStrength: () => {},
  updateExecText: () => {},
  updateHeroLayout: () => {},
  updateSectionField: () => {},
  updateLayoutTitle: () => {},
  updateBlockTitle: () => {},
  updateTimelinePhase: () => {},
  updateTimelineItem: () => {},
  updateAddOnField: () => {},
  updateAddOnBullet: () => {},
  toggleLayoutSectionHidden: () => {},
  toggleAuditSectionHidden: () => {},
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

  const schedule = useCallback((key: string, fn: () => Promise<void>) => {
    if (timers.current[key]) window.clearTimeout(timers.current[key]);
    setSaveStatus('saving');
    timers.current[key] = window.setTimeout(async () => {
      try {
        await fn();
        setSaveStatus('saved');
        window.setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 2000);
      } catch {
        setSaveStatus('error');
      }
    }, 500) as unknown as number;
  }, []);

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
      const findings = [...(prev.findings ?? [])];
      while (findings.length <= index) findings.push('');
      findings[index] = value;
      saveExecutive({ findings });
    },
    [getExecPayload, saveExecutive],
  );

  const updateStrength = useCallback(
    (index: number, value: string) => {
      const prev = getExecPayload();
      const strengths = [...(prev.strengths ?? [])];
      while (strengths.length <= index) strengths.push('');
      strengths[index] = value;
      saveExecutive({ strengths });
    },
    [getExecPayload, saveExecutive],
  );

  const updateExecText = useCallback(
    (value: string) => saveExecutive({ text: value }),
    [saveExecutive],
  );

  const updateHeroLayout = useCallback(
    (field: 'eyebrow' | 'headline' | 'intro', value: string) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const exec = { ...((layout.executive_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((exec.blocks as Record<string, unknown>) ?? {}) };
      const hero = { ...((blocks.hero as Record<string, unknown>) ?? {}), [field]: value || undefined };
      blocks.hero = hero;
      exec.blocks = blocks;
      layout.executive_summary = exec;
      onAuditChange({ ...audit, layout });
      schedule('layout-hero', async () => {
        await updateAudit(audit.id, { layout });
      });
    },
    [audit, onAuditChange, schedule],
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
    (layoutKey: 'executive_summary' | 'revenue_summary', patchFn: (section: Record<string, unknown>) => Record<string, unknown>) => {
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
    (layoutKey: 'executive_summary' | 'revenue_summary', field: 'sectionTitle' | 'sectionNumber', value: string) => {
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
      items[itemIndex] = value;
      timeline[phaseIndex] = { ...phase, items };
      saveExecutive({ timeline });
    },
    [getExecPayload, saveExecutive],
  );

  const updateAddOnField = useCallback(
    (itemKey: string, field: 'name' | 'description', value: string) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      items[idx] = { ...items[idx], [field]: value };
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

  const updateAddOnBullet = useCallback(
    (itemKey: string, bulletIndex: number, value: string) => {
      const layout = { ...((audit.layout as Record<string, unknown>) ?? {}) };
      const rs = { ...((layout.revenue_summary as Record<string, unknown>) ?? {}) };
      const blocks = { ...((rs.blocks as Record<string, unknown>) ?? {}) };
      const addOns = { ...((blocks.addOns as Record<string, unknown>) ?? {}) };
      const items = [...((addOns.items as RevenueOpportunityAddOnItem[]) ?? [])];
      const idx = items.findIndex(i => `${i.template_slug}-${i.display_order}` === itemKey);
      if (idx < 0) return;
      const bullets = [...(items[idx].bullets ?? [])];
      while (bullets.length <= bulletIndex) bullets.push('');
      bullets[bulletIndex] = value;
      items[idx] = { ...items[idx], bullets };
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

  const toggleLayoutSectionHidden = useCallback(
    (layoutKey: 'executive_summary' | 'revenue_summary', hidden: boolean) => {
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
      schedule(`section-hidden-${section.id}`, async () => {
        await updateAuditSection(section.id, { section_config: nextConfig });
      });
    },
    [sections, onSectionsChange, schedule],
  );

  const value = useMemo(
    () => ({
      editMode,
      saveStatus,
      updateFinding,
      updateStrength,
      updateExecText,
      updateHeroLayout,
      updateSectionField,
      updateLayoutTitle,
      updateBlockTitle,
      updateTimelinePhase,
      updateTimelineItem,
      updateAddOnField,
      updateAddOnBullet,
      toggleLayoutSectionHidden,
      toggleAuditSectionHidden,
    }),
    [
      editMode,
      saveStatus,
      updateFinding,
      updateStrength,
      updateExecText,
      updateHeroLayout,
      updateSectionField,
      updateLayoutTitle,
      updateBlockTitle,
      updateTimelinePhase,
      updateTimelineItem,
      updateAddOnField,
      updateAddOnBullet,
      toggleLayoutSectionHidden,
      toggleAuditSectionHidden,
    ],
  );

  return (
    <ReportEditContext.Provider value={value}>
      {children}
    </ReportEditContext.Provider>
  );
}

export { parseExecutiveSummary };
