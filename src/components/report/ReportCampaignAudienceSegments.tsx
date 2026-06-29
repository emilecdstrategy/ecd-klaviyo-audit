import { useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import type { KlaviyoCampaignSnapshot, KlaviyoSegmentSnapshot } from '../../lib/types';
import {
  buildCampaignAudienceRows,
  buildGroupNameMapFromSnapshots,
  findSegmentSnapshotForAudience,
  type CampaignAudienceRef,
} from '../../lib/campaign-audiences';
import {
  buildSegmentSignalTags,
  parseSegmentDefinition,
  type GroupNameMap,
} from '../../lib/segment-definition';
import Modal from '../ui/Modal';
import { cn } from '../../lib/utils';

type AudienceModalState = {
  ref: CampaignAudienceRef;
} | null;

function AudienceChip({
  audience,
  onClick,
}: {
  audience: CampaignAudienceRef;
  onClick: () => void;
}) {
  const isUnknown = audience.name.startsWith('Unknown audience');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-left text-xs font-medium transition-colors',
        isUnknown
          ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
          : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-brand-primary/30 hover:bg-brand-primary/5 hover:text-brand-primary',
      )}
    >
      <span className="mr-1 shrink-0 uppercase tracking-wide text-[10px] text-gray-400">
        {audience.kind}
      </span>
      <span className="truncate">{audience.name}</span>
    </button>
  );
}

function AudienceChipList({
  items,
  emptyLabel,
  onSelect,
}: {
  items: CampaignAudienceRef[];
  emptyLabel: string;
  onSelect: (ref: CampaignAudienceRef) => void;
}) {
  if (items.length === 0) {
    return <span className="text-xs text-gray-400 italic">{emptyLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <AudienceChip key={item.id} audience={item} onClick={() => onSelect(item)} />
      ))}
    </div>
  );
}

function SignalTag({ label, tone }: { label: string; tone: 'good' | 'warn' | 'neutral' }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold', cls)}>
      {label}
    </span>
  );
}

function tagTone(label: string): 'good' | 'warn' | 'neutral' {
  if (label.startsWith('Excludes Apple') || label.startsWith('Excludes bot') || label === 'Click-based engagement') {
    return 'good';
  }
  if (label.startsWith('Includes Apple') || label === 'Uses email opens') return 'warn';
  return 'neutral';
}

function AudienceDefinitionBody({
  audienceRef,
  segmentSnapshots,
  groupNames,
}: {
  audienceRef: CampaignAudienceRef;
  segmentSnapshots: KlaviyoSegmentSnapshot[];
  groupNames: GroupNameMap;
}) {
  if (audienceRef.kind === 'list') {
    return (
      <div className="px-5 py-5">
        <p className="text-sm text-gray-600 leading-relaxed">
          This is a Klaviyo <strong>list</strong> used as a campaign audience. Lists are static groups of profiles
          (unlike segments, which are built from dynamic rules). It is commonly used for suppressions or fixed cohorts
          such as hygiene groups.
        </p>
      </div>
    );
  }

  const segment = findSegmentSnapshotForAudience(audienceRef.id, segmentSnapshots);
  if (!segment) {
    return (
      <div className="px-5 py-5">
        <p className="text-sm text-gray-500 italic">
          Segment definition not found in this audit snapshot. Re-run the Klaviyo sync to pull criteria.
        </p>
      </div>
    );
  }

  const parsed = parseSegmentDefinition(segment, undefined, groupNames);
  const tags = buildSegmentSignalTags(parsed.signals);

  return (
    <div className="px-5 py-5">
      {tags.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <SignalTag key={tag} label={tag} tone={tagTone(tag)} />
          ))}
        </div>
      ) : null}
      {parsed.available ? (
        <ul className="space-y-2">
          {parsed.criteriaLines.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 italic">
          Segment definition not available. Re-run the Klaviyo sync to pull criteria.
        </p>
      )}
    </div>
  );
}

export default function ReportCampaignAudienceSegments({
  campaigns,
  segmentSnapshots,
}: {
  campaigns: KlaviyoCampaignSnapshot[];
  segmentSnapshots: KlaviyoSegmentSnapshot[];
}) {
  const [modal, setModal] = useState<AudienceModalState>(null);

  const groupNames = useMemo(
    () => buildGroupNameMapFromSnapshots(segmentSnapshots, campaigns),
    [segmentSnapshots, campaigns],
  );

  const rows = useMemo(
    () => buildCampaignAudienceRows(campaigns, groupNames, 30),
    [campaigns, groupNames],
  );

  if (rows.length === 0) return null;

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary/15 ring-1 ring-brand-primary/20">
              <Megaphone className="h-5 w-5 text-brand-primary" strokeWidth={2.25} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">Campaign audiences</h3>
              <p className="mt-0.5 text-sm text-gray-500">
                Included and excluded segments/lists for the 30 most recent sent email campaigns. Click an audience to
                see its definition.
              </p>
            </div>
          </div>
        </div>

        <div className="-mx-6 overflow-x-auto px-6">
          <table className="w-full min-w-[720px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Campaign
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Included
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Excluded
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ campaign, included, excluded }, i) => (
                <tr
                  key={campaign.id}
                  className={cn('border-b border-gray-50', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}
                >
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-gray-900">{campaign.display_name || campaign.name}</p>
                    {campaign.updated_at_klaviyo ? (
                      <p className="mt-0.5 text-xs text-gray-400">
                        Sent {new Date(campaign.updated_at_klaviyo).toLocaleDateString()}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top max-w-xs">
                    <AudienceChipList
                      items={included}
                      emptyLabel="No inclusions"
                      onSelect={ref => setModal({ ref })}
                    />
                  </td>
                  <td className="px-4 py-3 align-top max-w-xs">
                    <AudienceChipList
                      items={excluded}
                      emptyLabel="No exclusions"
                      onSelect={ref => setModal({ ref })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modal != null}
        title={
          modal
            ? `${modal.ref.kind === 'list' ? 'List' : 'Segment'}: ${modal.ref.name}`
            : undefined
        }
        onClose={() => setModal(null)}
      >
        {modal ? (
          <AudienceDefinitionBody
            audienceRef={modal.ref}
            segmentSnapshots={segmentSnapshots}
            groupNames={groupNames}
          />
        ) : null}
      </Modal>
    </>
  );
}
