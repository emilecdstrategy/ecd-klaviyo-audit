import {
  FileText,
  BarChart3,
  LayoutGrid,
  Target,
  Mail,
  Palette,
  FormInput,
  DollarSign,
  type LucideIcon,
} from 'lucide-react';
import { SECTION_LABELS } from '../../lib/constants';
import type { AuditSection } from '../../lib/types';
import RevenueOpportunityCard from '../ui/RevenueOpportunityCard';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import type { Audit } from '../../lib/types';

export type WorkspaceSectionKey =
  | 'executive_summary'
  | 'account_health'
  | 'flows'
  | 'segmentation'
  | 'campaigns'
  | 'email_design'
  | 'signup_forms'
  | 'revenue_summary';

const SECTION_ICONS: Record<WorkspaceSectionKey, LucideIcon> = {
  executive_summary: FileText,
  account_health: BarChart3,
  flows: LayoutGrid,
  segmentation: Target,
  campaigns: Mail,
  email_design: Palette,
  signup_forms: FormInput,
  revenue_summary: DollarSign,
};

const SECTION_HINTS: Partial<Record<WorkspaceSectionKey, string>> = {
  executive_summary: 'Key findings, strengths, and layout',
  account_health: 'Health score categories and overview',
  flows: 'Flow performance, inventory, and rubric',
  segmentation: 'Segments narrative and inventory',
  campaigns: 'Campaign analysis and inventory',
  email_design: 'Side-by-side email comparison',
  signup_forms: 'Form coverage and inventory',
  revenue_summary: 'Total opportunity, add-ons, and timeline',
};

export const WORKSPACE_NAV_GROUPS: {
  label: string;
  items: { key: WorkspaceSectionKey; label: string }[];
}[] = [
  {
    label: 'Report overview',
    items: [
      { key: 'executive_summary', label: 'Executive Summary' },
      { key: 'revenue_summary', label: 'Revenue Opportunity' },
    ],
  },
  {
    label: 'Audit sections',
    items: [
      { key: 'account_health', label: SECTION_LABELS.account_health },
      { key: 'flows', label: SECTION_LABELS.flows },
      { key: 'segmentation', label: SECTION_LABELS.segmentation },
      { key: 'campaigns', label: SECTION_LABELS.campaigns },
      { key: 'signup_forms', label: SECTION_LABELS.signup_forms },
      { key: 'email_design', label: SECTION_LABELS.email_design },
    ],
  },
];

export function workspaceSectionLabel(key: WorkspaceSectionKey): string {
  if (key === 'executive_summary') return 'Executive Summary';
  if (key === 'revenue_summary') return 'Revenue Opportunity';
  return SECTION_LABELS[key] ?? key;
}

export function workspaceSectionHint(key: WorkspaceSectionKey): string | undefined {
  return SECTION_HINTS[key];
}

function NavButton({
  sectionKey,
  label,
  isActive,
  approved,
  onSelect,
  compact,
}: {
  sectionKey: WorkspaceSectionKey;
  label: string;
  isActive: boolean;
  approved?: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const Icon = SECTION_ICONS[sectionKey];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex shrink-0 items-center gap-2 rounded-lg text-left transition-all ${
        compact ? 'px-3 py-2 text-xs' : 'w-full px-3 py-2.5 text-sm mb-0.5'
      } ${
        isActive
          ? 'bg-brand-primary/10 text-brand-primary font-medium ring-1 ring-brand-primary/20'
          : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      <Icon className={`shrink-0 ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} strokeWidth={2.25} />
      <span className={compact ? 'whitespace-nowrap' : 'truncate'}>{label}</span>
      {approved && (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="Approved" aria-hidden />
      )}
    </button>
  );
}

export function WorkspaceSidebar({
  activeSection,
  onSelect,
  sections,
  audit,
  totalRevenue,
  onStatusChange,
}: {
  activeSection: WorkspaceSectionKey;
  onSelect: (key: WorkspaceSectionKey) => void;
  sections: AuditSection[];
  audit: Audit;
  totalRevenue: number;
  onStatusChange: (status: Audit['status']) => void;
}) {
  const sectionByKey = (key: string) => sections.find(s => s.section_key === key);

  return (
    <aside className="hidden lg:flex w-60 xl:w-64 flex-col border-r border-gray-100 bg-white shrink-0">
      <div className="flex-1 overflow-y-auto p-3">
        {WORKSPACE_NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-5 last:mb-0">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {group.label}
            </p>
            {group.items.map(item => (
              <NavButton
                key={item.key}
                sectionKey={item.key}
                label={item.label}
                isActive={activeSection === item.key}
                approved={sectionByKey(item.key)?.status === 'approved'}
                onSelect={() => onSelect(item.key)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 p-3 space-y-3">
        <div className="px-1">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Workflow</p>
          <Select value={audit.status} onValueChange={v => onStatusChange(v as Audit['status'])}>
            <SelectTrigger className="h-9 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft"><SelectItemText>Draft</SelectItemText></SelectItem>
              <SelectItem value="in_review"><SelectItemText>In Review</SelectItemText></SelectItem>
              <SelectItem value="viewer_only"><SelectItemText>Viewer Only</SelectItemText></SelectItem>
              <SelectItem value="published"><SelectItemText>Published</SelectItemText></SelectItem>
            </SelectContent>
          </Select>
        </div>
        <RevenueOpportunityCard amount={totalRevenue} compact />
      </div>
    </aside>
  );
}

export function WorkspaceMobileNav({
  activeSection,
  onSelect,
}: {
  activeSection: WorkspaceSectionKey;
  onSelect: (key: WorkspaceSectionKey) => void;
}) {
  const allItems = WORKSPACE_NAV_GROUPS.flatMap(g => g.items);
  return (
    <div className="lg:hidden border-b border-gray-100 bg-white px-3 py-2 overflow-x-auto">
      <div className="flex gap-1.5 min-w-max">
        {allItems.map(item => (
          <NavButton
            key={item.key}
            sectionKey={item.key}
            label={item.label}
            isActive={activeSection === item.key}
            onSelect={() => onSelect(item.key)}
            compact
          />
        ))}
      </div>
    </div>
  );
}

export function WorkspaceSectionHeader({
  sectionKey,
  section,
}: {
  sectionKey: WorkspaceSectionKey;
  section?: AuditSection | null;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">
            {workspaceSectionLabel(sectionKey)}
          </h2>
          {workspaceSectionHint(sectionKey) && (
            <p className="mt-1 text-sm text-gray-500">{workspaceSectionHint(sectionKey)}</p>
          )}
        </div>
        {section && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
              section.status === 'approved'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {section.status === 'approved' ? 'Approved' : 'Draft'}
          </span>
        )}
      </div>
    </div>
  );
}
