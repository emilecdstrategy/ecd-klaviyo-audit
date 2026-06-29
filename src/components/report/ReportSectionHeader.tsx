import EditablePlainText from './edit/EditablePlainText';
import type { AuditSectionKey, SectionDemoMarker as SectionDemoMarkerData } from '../../lib/addon-highlight';
import type { RevenueOpportunityAddOnItem } from '../../lib/types';
import { cn } from '../../lib/utils';
import { useReportEdit } from './edit/ReportEditContext';
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
  const showTalkTrack = Boolean(sectionKey && (talkTrackMarkers.length > 0 || editMode));

  return (
    <div className={cn('mb-8', editMode && 'pr-24 sm:pr-28')}>
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
      {showTalkTrack && sectionKey ? (
        <SectionTalkTrackSectionRow
          sectionKey={sectionKey}
          markers={talkTrackMarkers}
          addOnItems={addOnItems}
          editMode={editMode}
        />
      ) : null}
    </div>
  );
}
