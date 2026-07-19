import { ArrowRight, Eye, EyeOff, Trash2, X } from 'lucide-react';
import type { WebFinding } from '../../../lib/web-report-details';
import type { WebPageSnapshot } from '../../../lib/types';
import { useReportEdit } from '../edit/ReportEditContext';
import EditablePlainText from '../edit/EditablePlainText';
import WebCropCard from './WebCropCard';

/**
 * A single finding rendered as a full-width card: the flagged crop (when the AI
 * pinpointed one) sits beside the issue text, with the recommended fix directly
 * underneath so the reader never has to hunt for the matching recommendation.
 */
export default function WebFindingCard({
  number,
  finding,
  cropShot,
  active,
  onActivate,
  onChangeText,
  onChangeRecommendation,
  onRemove,
  onRemoveHighlight,
  onToggleHidden,
}: {
  number: number;
  finding: WebFinding;
  cropShot?: WebPageSnapshot | null;
  active: boolean;
  onActivate: (active: boolean) => void;
  onChangeText: (value: string) => void;
  onChangeRecommendation: (value: string) => void;
  onRemove: () => void;
  onRemoveHighlight: () => void;
  onToggleHidden: () => void;
}) {
  const { editMode } = useReportEdit();
  const hasCrop = Boolean(finding.highlight && cropShot?.screenshot_url);

  return (
    <div
      id={`finding-${number}`}
      onMouseEnter={() => onActivate(true)}
      onMouseLeave={() => onActivate(false)}
      className={`scroll-mt-24 rounded-xl border p-4 transition-shadow ${
        active ? 'border-brand-primary/40 ring-1 ring-brand-primary/20' : 'border-gray-100'
      } ${finding.hidden ? 'opacity-50' : ''}`}
    >
      <div>
        {hasCrop && (
          <div className="relative mb-3">
            <WebCropCard index={number} imageUrl={cropShot!.screenshot_url as string} highlight={finding.highlight!} />
            {editMode && (
              <button
                type="button"
                onClick={onRemoveHighlight}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-gray-400 shadow hover:text-red-500"
                aria-label="Remove highlight"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-[11px] font-bold text-brand-primary">
              {number}
            </span>
            <div className="min-w-0 flex-1 text-sm text-gray-800">
              <EditablePlainText value={finding.text} onSave={onChangeText} placeholder="Finding…" />
            </div>
            {editMode && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleHidden}
                  className="text-gray-300 hover:text-gray-600"
                  aria-label={finding.hidden ? 'Show finding' : 'Hide finding'}
                  title={finding.hidden ? 'Show on report' : 'Hide from report'}
                >
                  {finding.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-gray-300 hover:text-red-500"
                  aria-label="Remove finding"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {(editMode || finding.recommendation) && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-brand-primary/5 p-3">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />
              <div className="min-w-0 flex-1 text-sm text-gray-600">
                <span className="font-medium text-gray-700">Recommended fix: </span>
                <EditablePlainText
                  value={finding.recommendation}
                  onSave={onChangeRecommendation}
                  placeholder="Recommendation…"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
