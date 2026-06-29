import { describe, expect, it } from 'vitest';
import {
  buildCampaignAudienceRows,
  buildGroupNameMapFromSnapshots,
  countUnknownAudiences,
  extractCampaignAudiences,
  isUnknownAudienceName,
  pickRecentSentCampaigns,
  resolveAudienceRef,
  UNKNOWN_AUDIENCE_LABEL,
} from './campaign-audiences';
import type { KlaviyoCampaignSnapshot, KlaviyoSegmentSnapshot } from './types';

const groupNames = {
  seg1: { name: 'Engaged 30 Day', kind: 'segment' as const },
  list1: { name: 'All Malicious', kind: 'list' as const },
};

describe('campaign-audiences', () => {
  it('picks recent sent email campaigns', () => {
    const campaigns: KlaviyoCampaignSnapshot[] = [
      { id: '1', audit_id: 'a', client_id: 'c', campaign_id: 'c1', name: 'Old', status: 'sent', send_channel: 'email', created_at_klaviyo: '2024-01-01', updated_at_klaviyo: '2024-01-02' },
      { id: '2', audit_id: 'a', client_id: 'c', campaign_id: 'c2', name: 'New', status: 'sent', send_channel: 'email', created_at_klaviyo: '2024-06-01', updated_at_klaviyo: '2024-06-02' },
      { id: '3', audit_id: 'a', client_id: 'c', campaign_id: 'c3', name: 'Draft', status: 'draft', send_channel: 'email', created_at_klaviyo: '2024-07-01', updated_at_klaviyo: '2024-07-02' },
    ];
    const picked = pickRecentSentCampaigns(campaigns);
    expect(picked.map(c => c.name)).toEqual(['New', 'Old']);
  });

  it('resolves included and excluded audience names', () => {
    const campaign: KlaviyoCampaignSnapshot = {
      id: '1',
      audit_id: 'a',
      client_id: 'c',
      campaign_id: 'c1',
      name: 'Sale',
      status: 'sent',
      send_channel: 'email',
      created_at_klaviyo: null,
      updated_at_klaviyo: null,
      raw: {
        attributes: {
          audiences: { included: ['seg1'], excluded: ['list1'] },
        },
      },
    };
    const aud = extractCampaignAudiences(campaign, groupNames);
    expect(aud.included[0].name).toBe('Engaged 30 Day');
    expect(aud.excluded[0].name).toBe('All Malicious');
    expect(aud.excluded[0].kind).toBe('list');
  });

  it('builds rows for recent sent campaigns', () => {
    const campaigns: KlaviyoCampaignSnapshot[] = [
      {
        id: '1',
        audit_id: 'a',
        client_id: 'c',
        campaign_id: 'c1',
        name: 'Sale',
        status: 'sent',
        send_channel: 'email',
        created_at_klaviyo: null,
        updated_at_klaviyo: '2024-06-02',
        raw: { attributes: { audiences: { included: ['seg1'], excluded: ['list1'] } } },
      },
    ];
    const rows = buildCampaignAudienceRows(campaigns, groupNames);
    expect(rows).toHaveLength(1);
    expect(rows[0].included[0].name).toBe('Engaged 30 Day');
  });

  it('merges group names from segment snapshots', () => {
    const segments: KlaviyoSegmentSnapshot[] = [
      {
        id: 's1',
        audit_id: 'a',
        client_id: 'c',
        segment_id: 'seg1',
        name: 'Engaged 30 Day',
        created_at_klaviyo: null,
        updated_at_klaviyo: null,
        raw: { _ecd_group_names: groupNames },
      },
    ];
    const map = buildGroupNameMapFromSnapshots(segments);
    expect(map.seg1.name).toBe('Engaged 30 Day');
    expect(map.list1.name).toBe('All Malicious');
  });

  it('marks unresolved audience ids as unknown', () => {
    const ref = resolveAudienceRef('missing-id', groupNames);
    expect(ref.name).toBe(UNKNOWN_AUDIENCE_LABEL);
    expect(isUnknownAudienceName(ref.name)).toBe(true);
  });

  it('counts unknown audiences across campaign rows', () => {
    const campaigns: KlaviyoCampaignSnapshot[] = [
      {
        id: '1',
        audit_id: 'a',
        client_id: 'c',
        campaign_id: 'c1',
        name: 'Sale',
        status: 'sent',
        send_channel: 'email',
        created_at_klaviyo: null,
        updated_at_klaviyo: '2024-06-02',
        raw: {
          attributes: {
            audiences: { included: ['seg1', 'missing1'], excluded: ['list1', 'missing2'] },
          },
        },
      },
    ];
    const rows = buildCampaignAudienceRows(campaigns, groupNames);
    expect(countUnknownAudiences(rows)).toBe(2);
    expect(rows[0].included.find(a => a.id === 'seg1')?.name).toBe('Engaged 30 Day');
  });

  it('resolves hydrated audience ids when added to group map', () => {
    const hydratedMap = {
      ...groupNames,
      missing1: { name: 'Hydrated Segment', kind: 'segment' as const },
    };
    const campaign: KlaviyoCampaignSnapshot = {
      id: '1',
      audit_id: 'a',
      client_id: 'c',
      campaign_id: 'c1',
      name: 'Sale',
      status: 'sent',
      send_channel: 'email',
      created_at_klaviyo: null,
      updated_at_klaviyo: null,
      raw: { attributes: { audiences: { included: ['missing1'], excluded: [] } } },
    };
    const aud = extractCampaignAudiences(campaign, hydratedMap);
    expect(aud.included[0].name).toBe('Hydrated Segment');
  });
});
