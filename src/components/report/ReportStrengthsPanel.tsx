import { CheckCircle2 } from 'lucide-react';
import EditableRichText from './edit/EditableRichText';
import EditablePlainText from './edit/EditablePlainText';
import { useReportEdit } from './edit/ReportEditContext';
import ReportBlockEditChrome, { ReportHiddenItemStub, ReportItemHideButton } from './edit/ReportBlockEditChrome';

export default function ReportStrengthsPanel({
  title,
  strengths,
  strengthsHidden = [],
  blockHidden = false,
}: {
  title: string;
  strengths: string[];
  strengthsHidden?: boolean[];
  blockHidden?: boolean;
}) {
  const { editMode, updateStrength, updateBlockTitle, toggleStrengthHidden, toggleExecutiveBlockHidden } = useReportEdit();
  const items = strengths.length > 0 ? strengths : ['', '', ''];

  const rows = items
    .map((s, i) => ({ s, i, hidden: Boolean(strengthsHidden[i]) }))
    .filter(row => editMode || (!row.hidden && row.s.trim().length > 0));

  return (
    <ReportBlockEditChrome
      label="What's Working"
      hidden={blockHidden}
      onToggleHidden={h => toggleExecutiveBlockHidden('strengths', h)}
    >
      <div className="mb-8 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-emerald-100/80 px-6 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={2.25} />
          <EditablePlainText
            value={title}
            onSave={v => updateBlockTitle('executive_summary', 'strengths', 'title', v)}
            className="text-base font-bold text-gray-900"
            as="h3"
          />
        </div>
        <ul className="space-y-4 px-6 py-5">
          {editMode
            ? items.map((s, i) => {
              const hidden = Boolean(strengthsHidden[i]);
              if (!hidden) {
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    <EditableRichText
                      value={s}
                      onSave={v => updateStrength(i, v)}
                      className="min-w-0 flex-1 text-sm leading-relaxed text-gray-700"
                      placeholder="Describe something the account is doing well…"
                    />
                    <ReportItemHideButton
                      hidden={hidden}
                      onToggleHidden={() => toggleStrengthHidden(i, true)}
                      title="Hide this strength"
                    />
                  </li>
                );
              }
              return (
                <li key={i}>
                  <ReportHiddenItemStub
                    label={`Strength ${i + 1}`}
                    onRestore={() => toggleStrengthHidden(i, false)}
                  />
                </li>
              );
            })
            : rows.map(({ s, i }) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <EditableRichText
                  value={s}
                  onSave={v => updateStrength(i, v)}
                  className="min-w-0 flex-1 text-sm leading-relaxed text-gray-700"
                  placeholder="Describe something the account is doing well…"
                />
              </li>
            ))}
        </ul>
      </div>
    </ReportBlockEditChrome>
  );
}
