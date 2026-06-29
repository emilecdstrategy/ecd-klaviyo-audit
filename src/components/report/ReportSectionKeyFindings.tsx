import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import EditableRichText from './edit/EditableRichText';
import EditablePlainText from './edit/EditablePlainText';
import { useReportEdit } from './edit/ReportEditContext';
import ReportBlockHeader from './ReportBlockHeader';
import ReportBlockEditChrome, { ReportHiddenItemStub, ReportItemHideButton } from './edit/ReportBlockEditChrome';

export type SectionKeyFindingsScope =
  | { kind: 'audit_section'; sectionKey: string }
  | { kind: 'layout'; layoutKey: 'deliverability_snapshot' | 'attribution_model' };

export default function ReportSectionKeyFindings({
  scope,
  title,
  subtitle,
  items,
  itemsHidden = [],
  blockHidden = false,
}: {
  scope: SectionKeyFindingsScope;
  title: string;
  subtitle?: string;
  items: string[];
  itemsHidden?: boolean[];
  blockHidden?: boolean;
}) {
  const {
    editMode,
    updateSectionKeyFinding,
    addSectionKeyFinding,
    removeSectionKeyFinding,
    toggleSectionKeyFindingHidden,
    toggleSectionKeyFindingsBlockHidden,
    updateSectionBlockField,
    updateLayoutBlockTitle,
  } = useReportEdit();

  const visibleEntries = items
    .map((item, index) => ({ item, index, hidden: Boolean(itemsHidden[index]) }))
    .filter(entry => editMode || (!entry.hidden && entry.item.trim().length > 0));

  const onToggleBlockHidden = (hidden: boolean) => {
    if (scope.kind === 'audit_section') {
      toggleSectionKeyFindingsBlockHidden(scope.sectionKey, hidden);
    } else {
      toggleSectionKeyFindingsBlockHidden(scope.layoutKey, hidden);
    }
  };

  const onUpdateItem = (index: number, value: string) => {
    if (scope.kind === 'audit_section') {
      updateSectionKeyFinding(scope.sectionKey, index, value);
    } else {
      updateSectionKeyFinding(scope.layoutKey, index, value);
    }
  };

  const onAddItem = () => {
    if (scope.kind === 'audit_section') {
      addSectionKeyFinding(scope.sectionKey);
    } else {
      addSectionKeyFinding(scope.layoutKey);
    }
  };

  const onRemoveItem = (index: number) => {
    if (scope.kind === 'audit_section') {
      removeSectionKeyFinding(scope.sectionKey, index);
    } else {
      removeSectionKeyFinding(scope.layoutKey, index);
    }
  };

  const onToggleItemHidden = (index: number, hidden: boolean) => {
    if (scope.kind === 'audit_section') {
      toggleSectionKeyFindingHidden(scope.sectionKey, index, hidden);
    } else {
      toggleSectionKeyFindingHidden(scope.layoutKey, index, hidden);
    }
  };

  const onSaveTitle = (value: string) => {
    if (scope.kind === 'audit_section') {
      updateSectionBlockField(scope.sectionKey, 'keyFindings', 'title', value);
    } else {
      updateLayoutBlockTitle(scope.layoutKey, 'keyFindings', 'title', value);
    }
  };

  const onSaveSubtitle = (value: string) => {
    if (scope.kind === 'audit_section') {
      updateSectionBlockField(scope.sectionKey, 'keyFindings', 'subtitle', value);
    } else {
      updateLayoutBlockTitle(scope.layoutKey, 'keyFindings', 'subtitle', value);
    }
  };

  if (!editMode && blockHidden) return null;
  if (!editMode && visibleEntries.length === 0) return null;

  return (
    <ReportBlockEditChrome
      label="Key Findings"
      hidden={blockHidden}
      onToggleHidden={onToggleBlockHidden}
      className="mt-6"
    >
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <ReportBlockHeader
          className="border-b border-gray-200 bg-gray-50 px-6 py-4"
          icon={
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/15 ring-1 ring-brand-primary/20">
              <AlertCircle className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
            </div>
          }
          title={
            editMode ? (
              <EditablePlainText
                value={title}
                onSave={onSaveTitle}
                className="text-lg font-bold text-gray-900"
                as="span"
              />
            ) : (
              <span className="text-lg font-bold text-gray-900">{title}</span>
            )
          }
          subtitle={
            editMode ? (
              <EditablePlainText
                value={(subtitle ?? '').trim() || 'Priority gaps to discuss in this section'}
                onSave={onSaveSubtitle}
                className="text-sm text-gray-500"
                as="span"
              />
            ) : (
              subtitle ? <span className="text-sm text-gray-500">{subtitle}</span> : null
            )
          }
          titleClassName="text-lg font-bold text-gray-900"
        />

        <ul className="divide-y divide-gray-100">
          {items.map((item, i) => {
            const hidden = Boolean(itemsHidden[i]);
            if (!editMode && hidden) return null;
            if (!item.trim()) {
              if (!editMode) return null;
              if (i !== items.length - 1) return null;
            }

            if (editMode && hidden) {
              return (
                <li key={i} className="px-6 py-4">
                  <ReportHiddenItemStub
                    label={`Finding ${i + 1}`}
                    onRestore={() => onToggleItemHidden(i, false)}
                  />
                </li>
              );
            }

            return (
              <li
                key={i}
                className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-4 px-6 py-4 sm:gap-x-5 sm:py-5"
              >
                <span
                  aria-hidden
                  className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary"
                />
                {editMode ? (
                  <>
                    <EditableRichText
                      value={item}
                      onSave={v => onUpdateItem(i, v)}
                      className="min-w-0 text-base leading-relaxed text-gray-700"
                      placeholder="Describe a specific problem or gap…"
                    />
                    <div className="flex shrink-0 flex-col gap-1">
                      <ReportItemHideButton
                        hidden={hidden}
                        onToggleHidden={() => onToggleItemHidden(i, true)}
                        title="Hide this finding"
                      />
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveItem(i)}
                          title="Remove this finding"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:border-red-200 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <EditableRichText
                    value={item}
                    className="min-w-0 text-base leading-relaxed text-gray-700"
                  />
                )}
              </li>
            );
          })}
          {!editMode && visibleEntries.length === 0 && (
            <li className="px-6 py-6 text-center text-sm text-gray-500">No key findings for this section.</li>
          )}
        </ul>

        {editMode && (
          <div className="border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onAddItem}
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
