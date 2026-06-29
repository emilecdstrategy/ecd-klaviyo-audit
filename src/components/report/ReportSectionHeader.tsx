import EditablePlainText from './edit/EditablePlainText';
import SectionTalkTrackPills from './SectionTalkTrackPills';
import type { SectionDemoMarker as SectionDemoMarkerData } from '../../lib/addon-highlight';

export default function ReportSectionHeader({
  number,
  label,
  onSaveLabel,
  demoMarkers,
}: {
  number: string;
  label: string;
  onSaveLabel?: (value: string) => void;
  demoMarkers?: SectionDemoMarkerData[];
}) {
  const talkTrackMarkers = demoMarkers ?? [];

  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
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
      {talkTrackMarkers.length > 0 ? (
        <SectionTalkTrackPills markers={talkTrackMarkers} />
      ) : null}
    </div>
  );
}
