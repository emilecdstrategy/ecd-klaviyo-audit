import EditablePlainText from './edit/EditablePlainText';
import type { AuditSectionKey, SectionDemoMarker as SectionDemoMarkerData } from '../../lib/addon-highlight';
import type { RevenueOpportunityAddOnItem } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useReportEdit } from './edit/ReportEditContext';
import SectionTalkTrackPills from './SectionTalkTrackPills';
import SectionTalkTrackSectionRow from './SectionTalkTrackSectionRow';

export default function ReportSectionHeader({
  number,
  label,
  onSaveLabel,
  demoMarkers,
  sectionKey,
  addOnItems = [],
}: {
  number: string;
  label: string;
  onSaveLabel?: (value: string) => void;
  demoMarkers?: SectionDemoMarkerData[];
  /** When set, enables per-section talk-track pills (view + edit). */
  sectionKey?: AuditSectionKey;
  addOnItems?: RevenueOpportunityAddOnItem[];
}) {
  const { editMode } = useReportEdit();
  const talkTrackMarkers = demoMarkers ?? [];
  const showTalkTrackEditor = Boolean(sectionKey && editMode);
  const showInlinePills = !editMode && talkTrackMarkers.length > 0;

  return (
    <div className={cn('mb-8', editMode && 'pr-24 sm:pr-28')}>
      <div
        className={cn(
          'flex gap-4',
          showInlinePills
            ? 'flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6'
            : 'min-w-0 items-center',
        )}
      >
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-sm font-bold text-white tabular-nums shadow-sm shadow-brand-primary/25">
            {number}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-primary/80">
              Section {number}
            </p>
            <EditablePlainText
              value={label}
              onSave={onSaveLabel}
              as="h2"
              className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl"
            />
          </div>
        </div>
        {showInlinePills ? (
          <SectionTalkTrackPills markers={talkTrackMarkers} align="end" className="shrink-0" />
        ) : null}
      </div>
      {showTalkTrackEditor && sectionKey ? (
        <SectionTalkTrackSectionRow
          sectionKey={sectionKey}
          markers={talkTrackMarkers}
          addOnItems={addOnItems}
        />
      ) : null}
    </div>
  );
}
