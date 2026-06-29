import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import EditableRichText from './edit/EditableRichText';
import EditablePlainText from './edit/EditablePlainText';
import { useReportEdit } from './edit/ReportEditContext';
import ReportBlockHeader from './ReportBlockHeader';
import ReportBlockEditChrome, { ReportHiddenItemStub, ReportItemHideButton } from './edit/ReportBlockEditChrome';

export default function ReportKeyFindings({
  title,
  subtitle,
  findings,
  findingsHidden = [],
  blockHidden = false,
}: {
  title: string;
  subtitle?: string;
  findings: string[];
  findingsHidden?: boolean[];
  blockHidden?: boolean;
}) {
  const {
    editMode,
    updateFinding,
    addFinding,
    removeFinding,
    updateBlockTitle,
    toggleFindingHidden,
    toggleExecutiveBlockHidden,
  } = useReportEdit();
  const displayFindings = findings;

  const visibleEntries = displayFindings
    .map((finding, index) => ({ finding, index, hidden: Boolean(findingsHidden[index]) }))
    .filter(entry => editMode || (!entry.hidden && entry.finding.trim().length > 0));

  let visibleNumber = 0;

  return (
    <ReportBlockEditChrome
      label="General Key Findings"
      hidden={blockHidden}
      onToggleHidden={h => toggleExecutiveBlockHidden('findings', h)}
    >
      <div className="mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <ReportBlockHeader
          icon={
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10">
              <AlertCircle className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
            </div>
          }
          title={
            <EditablePlainText
              value={title}
              onSave={v => updateBlockTitle('executive_summary', 'findings', 'title', v)}
              className="text-lg font-bold text-gray-900"
              as="span"
            />
          }
          subtitle={
            <EditablePlainText
              value={(subtitle ?? '').trim() || 'Priority gaps identified in your Klaviyo account'}
              onSave={v => updateBlockTitle('executive_summary', 'findings', 'subtitle', v)}
              className="text-sm text-gray-500"
              as="span"
            />
          }
          titleClassName="text-lg font-bold text-gray-900"
        />

        <ol className="divide-y divide-gray-100">
          {displayFindings.map((finding, i) => {
            const hidden = Boolean(findingsHidden[i]);
            if (!editMode && hidden) return null;
            if (!finding.trim()) {
              if (!editMode) return null;
              if (i !== displayFindings.length - 1) return null;
            }

            if (editMode && hidden) {
              return (
                <li key={i} className="px-6 py-4">
                  <ReportHiddenItemStub
                    label={`Finding ${String(i + 1).padStart(2, '0')}`}
                    onRestore={() => toggleFindingHidden(i, false)}
                  />
                </li>
              );
            }

            visibleNumber += 1;
            return (
              <li
                key={i}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-4 px-6 py-5 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:gap-x-5 sm:py-6"
              >
                <span
                  aria-hidden
                  className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-dark text-xs font-bold leading-none text-white tabular-nums shadow-md shadow-brand-primary/20"
                >
                  {String(visibleNumber).padStart(2, '0')}
                </span>
                <EditableRichText
                  value={finding}
                  onSave={v => updateFinding(i, v)}
                  className="min-w-0 text-base leading-relaxed text-gray-700"
                  placeholder="Describe a specific problem or gap…"
                />
                <div className="flex shrink-0 flex-col gap-1">
                  <ReportItemHideButton
                    hidden={hidden}
                    onToggleHidden={() => toggleFindingHidden(i, true)}
                    title="Hide this finding"
                  />
                  {displayFindings.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeFinding(i)}
                      title="Remove this finding"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:border-red-200 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {!editMode && visibleEntries.length === 0 && (
            <li className="px-6 py-8 text-center text-sm text-gray-500">No key findings for this audit.</li>
          )}
        </ol>

        {editMode && (
          <div className="border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={addFinding}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand-primary/40 hover:bg-brand-primary/5 hover:text-brand-primary"
            >
              <Plus className="h-4 w-4" />
              Add finding
            </button>
          </div>
        )}
      </div>
    </ReportBlockEditChrome>
  );
}
