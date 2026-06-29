import type { KlaviyoCampaignSnapshot, KlaviyoSegmentSnapshot } from './types';
import { mergeGroupNameMaps, type GroupNameEntry, type GroupNameMap } from './segment-definition';

export type CampaignAudienceRef = {
  id: string;
  name: string;
  kind: GroupNameEntry['kind'];
};

export type CampaignAudienceRow = {
  campaign: KlaviyoCampaignSnapshot;
  included: CampaignAudienceRef[];
  excluded: CampaignAudienceRef[];
};

const UNKNOWN_LABEL = 'Unknown audience (re-sync needed)';

export function extractGroupNamesFromRaw(raw: unknown): GroupNameMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const map = (raw as Record<string, unknown>)._ecd_group_names;
  if (map && typeof map === 'object') return map as GroupNameMap;
  return undefined;
}

export function buildGroupNameMapFromSnapshots(
  segmentSnapshots: KlaviyoSegmentSnapshot[],
  campaignSnapshots: KlaviyoCampaignSnapshot[] = [],
): GroupNameMap {
  const fromRaw = mergeGroupNameMaps(
    ...segmentSnapshots.map(s => extractGroupNamesFromRaw(s.raw)),
    ...campaignSnapshots.map(c => extractGroupNamesFromRaw(c.raw)),
  );
  const fromSegments: GroupNameMap = {};
  for (const s of segmentSnapshots) {
    if (!s.segment_id) continue;
    fromSegments[s.segment_id] = {
      name: s.display_name || s.name || s.segment_id,
      kind: 'segment',
    };
  }
  return mergeGroupNameMaps(fromSegments, fromRaw);
}

export function resolveAudienceRef(id: string, groupNames: GroupNameMap): CampaignAudienceRef {
  const entry = groupNames[id];
  if (entry?.name) {
    return { id, name: entry.name, kind: entry.kind };
  }
  return { id, name: UNKNOWN_LABEL, kind: 'segment' };
}

export function extractCampaignAudiences(
  campaign: KlaviyoCampaignSnapshot,
  groupNames: GroupNameMap,
): { included: CampaignAudienceRef[]; excluded: CampaignAudienceRef[] } {
  const raw = campaign.raw as Record<string, unknown> | undefined;
  const attrs = raw?.attributes as Record<string, unknown> | undefined;
  const audiences = attrs?.audiences as Record<string, unknown> | undefined;
  const includedIds = Array.isArray(audiences?.included)
    ? (audiences.included as string[]).map(String).filter(Boolean)
    : [];
  const excludedIds = Array.isArray(audiences?.excluded)
    ? (audiences.excluded as string[]).map(String).filter(Boolean)
    : [];
  return {
    included: includedIds.map(id => resolveAudienceRef(id, groupNames)),
    excluded: excludedIds.map(id => resolveAudienceRef(id, groupNames)),
  };
}

export function pickRecentSentCampaigns(
  campaigns: KlaviyoCampaignSnapshot[],
  limit = 30,
): KlaviyoCampaignSnapshot[] {
  return [...campaigns]
    .filter(c => !c.is_hidden)
    .filter(c => (c.status ?? '').toLowerCase() === 'sent')
    .filter(c => (c.send_channel ?? 'email').toLowerCase() === 'email')
    .sort((a, b) => {
      const da = a.updated_at_klaviyo || a.created_at_klaviyo || '';
      const db = b.updated_at_klaviyo || b.created_at_klaviyo || '';
      return db.localeCompare(da);
    })
    .slice(0, limit);
}

export function buildCampaignAudienceRows(
  campaigns: KlaviyoCampaignSnapshot[],
  groupNames: GroupNameMap,
  limit = 30,
): CampaignAudienceRow[] {
  return pickRecentSentCampaigns(campaigns, limit).map(campaign => {
    const { included, excluded } = extractCampaignAudiences(campaign, groupNames);
    return { campaign, included, excluded };
  });
}

export function collectReferencedGroupIds(rows: CampaignAudienceRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const ref of [...row.included, ...row.excluded]) {
      if (ref.name !== UNKNOWN_LABEL) ids.add(ref.id);
    }
  }
  return ids;
}

export function findSegmentSnapshotForAudience(
  audienceId: string,
  segmentSnapshots: KlaviyoSegmentSnapshot[],
): KlaviyoSegmentSnapshot | undefined {
  return segmentSnapshots.find(s => s.segment_id === audienceId);
}
