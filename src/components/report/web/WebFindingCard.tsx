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
  pinned,
  anchorId,
  finding,
  cropShot,
  active,
  dimmed,
  onActivate,
  onChangeText,
  onChangeRecommendation,
  onRemove,
  onRemoveHighlight,
  onToggleHidden,
}: {
  number: number;
  /** False when nothing on the current screenshot carries this number, which is
   *  the honest answer for something the capture cannot photograph, such as a
   *  popup it strips before taking the shot. These sort to the end of the list,
   *  so the markers on the image never skip a number. */
  pinned?: boolean;
  /** Unique DOM id so pins can scroll to the right finding across sections. */
  anchorId?: string;
  finding: WebFinding;
  cropShot?: WebPageSnapshot | null;
  active: boolean;
  /** Another finding's pin is being hovered, so this one steps back and lets it
   *  stand out. Only ever set from the screenshot side: reading down the list
   *  should not fade the list. */
  dimmed?: boolean;
  onActivate: (active: boolean) => void;
  onChangeText: (value: string) => void;
  onChangeRecommendation: (value: string) => void;
  onRemove: () => void;
  onRemoveHighlight: () => void;
  onToggleHidden: () => void;
}) {
  const { editMode } = useReportEdit();
  const hasCrop = Boolean(finding.highlight && cropShot?.screenshot_url);
  // One opacity, decided here. Two opacity utilities on the same element do not
  // combine, they race on stylesheet order, so being dimmed and being hidden
  // have to resolve to a single class.
  const fade = dimmed ? 'opacity-40' : finding.hidden ? 'opacity-50' : '';

  return (
    <div
      id={anchorId ?? `finding-${number}`}
      onMouseEnter={() => onActivate(true)}
      onMouseLeave={() => onActivate(false)}
      className={`scroll-mt-24 rounded-xl border p-4 transition duration-150 ${
        active ? 'border-brand-primary ring-2 ring-brand-primary/25' : 'border-gray-300'
      } ${fade}`}
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
            {/* Muted when there is no marker carrying this number, so the
                reader can tell at a glance not to go looking for one. */}
            <span
              title={pinned === false ? 'Not visible in this screenshot' : undefined}
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                pinned === false ? 'bg-gray-100 text-gray-400' : 'bg-brand-primary/10 text-brand-primary'
              }`}
            >
              {number}
            </span>
            <div className="min-w-0 flex-1 text-[13px] text-gray-800">
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
              <div className="min-w-0 flex-1 text-[13px] text-gray-600">
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
