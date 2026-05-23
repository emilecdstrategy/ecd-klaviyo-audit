import type {
  AuditSection,
  HealthScoreItem,
  KlaviyoCampaignSnapshot,
  KlaviyoFlowSnapshot,
  KlaviyoFormSnapshot,
  KlaviyoSegmentSnapshot,
} from './types';

type AccountSnapshot = {
  bounce_rate_90d?: number | null;
  spam_rate_90d?: number | null;
  active_profiles_90d_count?: number | null;
  email_subscribed_profiles_count?: number | null;
} | null | undefined;

function statusFromRatio(ratio: number): HealthScoreItem['status'] {
  if (ratio >= 0.7) return 'good';
  if (ratio >= 0.45) return 'warning';
  return 'bad';
}

function item(
  category: string,
  score: number,
  max_score: number,
  note: string,
): HealthScoreItem {
  const ratio = max_score > 0 ? score / max_score : 0;
  return { category, score, max_score, status: statusFromRatio(ratio), note };
}

/** Derive account health categories when `health_scores` table rows are missing. */
export function deriveAccountHealthScores(input: {
  sections: AuditSection[];
  flowSnapshots: KlaviyoFlowSnapshot[];
  segmentSnapshots: KlaviyoSegmentSnapshot[];
  campaignSnapshots: KlaviyoCampaignSnapshot[];
  formSnapshots: KlaviyoFormSnapshot[];
  accountSnapshot?: AccountSnapshot;
}): HealthScoreItem[] {
  const { sections, flowSnapshots, segmentSnapshots, campaignSnapshots, formSnapshots, accountSnapshot } = input;
  const scores: HealthScoreItem[] = [];

  const liveFlows = flowSnapshots.filter(f => !['draft', 'paused'].includes(String(f.status ?? '').toLowerCase()));
  const flowScore = flowSnapshots.length === 0
    ? 0
    : Math.min(20, Math.round((liveFlows.length / Math.max(flowSnapshots.length, 1)) * 14) + Math.min(liveFlows.length, 6));
  scores.push(item(
    'Flow Automation',
    flowScore,
    20,
    liveFlows.length > 0
      ? `${liveFlows.length} live flow${liveFlows.length === 1 ? '' : 's'} of ${flowSnapshots.length} total in Klaviyo.`
      : 'No live automated flows detected for this account.',
  ));

  const segSection = sections.find(s => s.section_key === 'segmentation');
  const segDetails = (segSection?.section_details as Record<string, unknown> | null | undefined)?.segmentation as Record<string, unknown> | undefined;
  let segScore = Math.min(10, Math.round(segmentSnapshots.length / 3));
  if (segDetails?.has_engaged_unengaged_segments) segScore += 4;
  if (segDetails?.has_vip_segments) segScore += 3;
  if (segDetails?.sends_to_full_list) segScore = Math.max(0, segScore - 4);
  segScore = Math.min(20, segScore);
  scores.push(item(
    'Segmentation',
    segScore,
    20,
    segmentSnapshots.length > 0
      ? `${segmentSnapshots.length} segment${segmentSnapshots.length === 1 ? '' : 's'} configured${segDetails?.sends_to_full_list ? '; full-list sends detected' : ''}.`
      : 'Limited or no audience segmentation in use.',
  ));

  const sentCampaigns = campaignSnapshots.filter(c => Number(c.recipients ?? 0) > 0 || String(c.status ?? '').toLowerCase() === 'sent');
  const campScore = campaignSnapshots.length === 0
    ? 0
    : Math.min(20, Math.round((sentCampaigns.length / Math.max(campaignSnapshots.length, 1)) * 12) + Math.min(sentCampaigns.length, 8));
  scores.push(item(
    'Campaign Program',
    campScore,
    20,
    campaignSnapshots.length > 0
      ? `${sentCampaigns.length} recent campaign${sentCampaigns.length === 1 ? '' : 's'} with audience activity.`
      : 'No recent campaign activity pulled from Klaviyo.',
  ));

  const liveForms = formSnapshots.filter(f => ['live', 'published'].includes(String(f.status ?? '').toLowerCase()));
  const formScore = formSnapshots.length === 0
    ? 0
    : Math.min(20, Math.round((liveForms.length / Math.max(formSnapshots.length, 1)) * 14) + Math.min(liveForms.length, 6));
  scores.push(item(
    'List Growth',
    formScore,
    20,
    formSnapshots.length > 0
      ? `${liveForms.length} active signup form${liveForms.length === 1 ? '' : 's'} of ${formSnapshots.length} total.`
      : 'No signup forms detected in Klaviyo.',
  ));

  const bounce = accountSnapshot?.bounce_rate_90d;
  const spam = accountSnapshot?.spam_rate_90d;
  let delScore = 12;
  let delNote = 'Deliverability metrics not available for this audit run.';
  if (bounce != null || spam != null) {
    if (bounce != null && bounce > 0.02) delScore -= 6;
    else if (bounce != null && bounce > 0.01) delScore -= 3;
    if (spam != null && spam > 0.003) delScore -= 6;
    else if (spam != null && spam > 0.001) delScore -= 3;
    delScore = Math.max(0, Math.min(20, delScore));
    delNote = `90-day bounce ${bounce != null ? `${(bounce * 100).toFixed(2)}%` : 'n/a'}, spam ${spam != null ? `${(spam * 100).toFixed(3)}%` : 'n/a'}.`;
  }
  scores.push(item('Deliverability', delScore, 20, delNote));

  return scores;
}

export function resolveHealthScores(
  stored: HealthScoreItem[],
  derived: HealthScoreItem[],
): HealthScoreItem[] {
  if (stored.length > 0) return stored;
  return derived;
}
