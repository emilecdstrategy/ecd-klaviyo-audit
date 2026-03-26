import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Check } from 'lucide-react';
import type { AuditSection, AuditAsset, Annotation } from '../../lib/types';
import { SECTION_LABELS, CONFIDENCE_LABELS } from '../../lib/constants';
import RevenueOpportunityCard from '../ui/RevenueOpportunityCard';
import StatusBadge from '../ui/StatusBadge';
import SideBySideComparison from './SideBySideComparison';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface AuditSectionEditorProps {
  section: AuditSection;
  assets: AuditAsset[];
  annotations: Annotation[];
  onUpdate: (updates: Partial<AuditSection>) => void;
  onAddAnnotation?: (side: 'current' | 'optimized', x: number, y: number, label: string) => void;
  onRemoveAnnotation?: (id: string) => void;
}

export default function AuditSectionEditor({
  section,
  assets,
  annotations,
  onUpdate,
  onAddAnnotation,
  onRemoveAnnotation,
}: AuditSectionEditorProps) {
  const [expanded, setExpanded] = useState(true);

  const currentAsset = assets.find(a => a.section_key === section.section_key && a.side === 'current');
  const optimizedAsset = assets.find(a => a.section_key === section.section_key && a.side === 'optimized');
  const sectionAnnotations = annotations.filter(a => a.audit_section_id === section.id);

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
        </div>
        <div className="flex items-center gap-3">
          {section.revenue_opportunity > 0 && (
            <RevenueOpportunityCard amount={section.revenue_opportunity} compact />
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-6 border-t border-gray-50 pt-4">
          {section.ai_findings && (
            <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-brand-primary" />
                <span className="text-sm font-medium text-brand-primary">AI Findings</span>
              </div>
              <p className="text-sm text-gray-700">{section.ai_findings}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  Current State Title
                </label>
                <input
                  type="text"
                  value={section.current_state_title}
                  onChange={e => onUpdate({ current_state_title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  Current State Notes
                </label>
                <textarea
                  value={section.current_state_notes}
                  onChange={e => onUpdate({ current_state_notes: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  Optimized State Title
                </label>
                <input
                  type="text"
                  value={section.optimized_state_title}
                  onChange={e => onUpdate({ optimized_state_title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                  Optimized Benchmark Notes
                </label>
                <textarea
                  value={section.optimized_notes}
                  onChange={e => onUpdate({ optimized_notes: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
                />
              </div>
            </div>
          </div>

          {(currentAsset || optimizedAsset) && (
            <SideBySideComparison
              currentAsset={currentAsset}
              optimizedAsset={optimizedAsset}
              currentAnnotations={sectionAnnotations.filter(a => a.side === 'current')}
              optimizedAnnotations={sectionAnnotations.filter(a => a.side === 'optimized')}
              currentTitle={section.current_state_title || 'Current State'}
              optimizedTitle={section.optimized_state_title || 'Optimized State'}
              onAddAnnotation={onAddAnnotation}
              onRemoveAnnotation={onRemoveAnnotation}
              editable
            />
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Edited Findings
            </label>
            <textarea
              value={section.human_edited_findings}
              onChange={e => onUpdate({ human_edited_findings: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
              Summary (2-3 sentences, client-facing)
            </label>
            <textarea
              value={section.summary_text}
              onChange={e => onUpdate({ summary_text: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 resize-none"
            />
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
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Status
              </label>
              <div className="flex items-center gap-2">
                {(['draft', 'reviewed', 'approved'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => onUpdate({ status: s })}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      section.status === s
                        ? 'bg-brand-primary text-white'
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
        </div>
      )}
    </div>
  );
}
