import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Workflow,
  Zap,
  MousePointerClick,
  Send,
  Users,
  UserCheck,
  UserX,
  Clock,
  MailX,
  ShieldAlert,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import type { FlowPerformance, KlaviyoCampaignSnapshot, KlaviyoFlowSnapshot } from '../../lib/types';
import { CAMPAIGN_SNAPSHOT_CAP, campaignTotalSubtext, formatCampaignTotalDisplay } from '../../lib/campaign-count';

function normalizeReportingDiagnostic(raw?: string | null) {
  const msg = (raw ?? '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  if (lower.includes('throttle') || lower.includes('"code":"throttled"') || lower.includes('status":429')) {
    const m = msg.match(/expected available in\s+(\d+)\s+seconds/i);
    const wait = m?.[1] ? ` (try again in ~${m[1]}s)` : '';
    return `Klaviyo rate-limited reporting requests${wait}. Re-run the audit shortly.`;
  }
  if (msg.length > 140) return `${msg.slice(0, 140)}…`;
  return msg;
}

function formatPct(n: number | null) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(n < 0.01 ? 2 : 1)}%`;
}

/** Spam/bounce rates can be tiny; show extra precision when above zero but under 0.01%. */
function formatRatePct(n: number | null) {
  if (n == null || Number.isNaN(n)) return '—';
  const pct = n * 100;
  if (pct <= 0) return '0.00%';
  if (pct < 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(pct < 1 ? 2 : 1)}%`;
}

function formatInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return 'N/A';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function formatIntWithTruncFlag(n: number | null, truncated: boolean | null | undefined) {
  if (n == null || !Number.isFinite(n)) return 'N/A';
  const s = new Intl.NumberFormat('en-US').format(Math.round(n));
  if (truncated) return `~${s}`;
  return s;
}

function calcWeeklySendFrequency(campaigns: KlaviyoCampaignSnapshot[]) {
  const now = Date.now();
  const days30 = 30 * 24 * 60 * 60 * 1000;
  const recentSent = campaigns.filter((c) => {
    const status = (c.status || '').toLowerCase();
    if (status !== 'sent') return false;
    const t = c.updated_at_klaviyo ? new Date(c.updated_at_klaviyo).getTime() : 0;
    return t > 0 && now - t <= days30;
  }).length;
  const perWeek = (recentSent / 30) * 7;
  return { recentSent, perWeek };
}

export const METRIC_ICON_CHIP_CLASS = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100';
export const METRIC_ICON_CLASS = 'h-3.5 w-3.5 shrink-0 stroke-gray-500 text-gray-500';

function Card({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {Icon && (
          <div className={METRIC_ICON_CHIP_CLASS}>
            <Icon className={METRIC_ICON_CLASS} strokeWidth={2} />
          </div>
        )}
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-900">{value}</p>
      <p className="mt-1.5 text-xs leading-snug text-gray-500">{sub}</p>
    </div>
  );
}

function BenchmarkCallout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-100 bg-[#f9f9f9] p-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <div className="text-sm leading-relaxed text-gray-700">{children}</div>
    </div>
  );
}

export default function ReportAccountSnapshot({
  flowSnapshots,
  flowPerformance,
  campaignSnapshots,
  reportingDiagnostic,
  accountSnapshot,
}: {
  flowSnapshots: KlaviyoFlowSnapshot[];
  flowPerformance: FlowPerformance[];
  campaignSnapshots: KlaviyoCampaignSnapshot[];
  reportingDiagnostic?: string | null;
  accountSnapshot?: {
    total_profiles_count?: number | null;
    email_subscribed_profiles_count: number | null;
    active_profiles_90d_count: number | null;
    suppressed_profiles_count: number | null;
    bounce_rate_90d: number | null;
    spam_rate_90d: number | null;
    active_profiles_definition?: string | null;
    computed_at?: string | null;
    email_subscribed_profiles_truncated?: boolean | null;
    active_profiles_90d_truncated?: boolean | null;
    suppressed_profiles_truncated?: boolean | null;
    campaigns_truncated?: boolean | null;
    deliverability_campaign_timeframe?: 'last_30_days' | 'last_90_days' | null;
    profile_scan_status?: 'pending' | 'complete' | 'failed' | 'skipped' | null;
  } | null;
}) {
  const totalFlows = flowSnapshots.length;
  const liveFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const totalCampaigns = campaignSnapshots.length;
  const campaignsTruncated = accountSnapshot?.campaigns_truncated ?? totalCampaigns > CAMPAIGN_SNAPSHOT_CAP;
  const totalCampaignsDisplay = formatCampaignTotalDisplay(totalCampaigns, campaignsTruncated);
  const totalCampaignsSub = campaignTotalSubtext(totalCampaigns, campaignsTruncated);
  const manualFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'manual' || f.trigger_type === 'Unconfigured').length;

  const hasPerf = flowPerformance.length > 0;
  const totalRecipients = hasPerf ? flowPerformance.reduce((s, f) => s + (f.recipients_per_month ?? 0), 0) : null;
  const weightedConv = hasPerf && totalRecipients && totalRecipients > 0
    ? flowPerformance.reduce((s, f) => s + (f.actual_conv_rate ?? 0) * (f.recipients_per_month ?? 0), 0) / totalRecipients
    : null;
  const revenuePerRecipient = hasPerf && totalRecipients && totalRecipients > 0
    ? (flowPerformance.reduce((s, f) => s + (f.monthly_revenue_current ?? 0), 0) / totalRecipients)
    : null;

  const perfUnavailableReason = normalizeReportingDiagnostic(reportingDiagnostic) || 'not enough reporting data available';
  const { recentSent, perWeek } = calcWeeklySendFrequency(campaignSnapshots);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card icon={Workflow} label="Total Flows" value={String(totalFlows)} sub="in Klaviyo account" />
        <Card icon={Zap} label="Live Flows" value={String(liveFlows)} sub="actively sending" />
        <Card icon={MousePointerClick} label="Manual Flows" value={String(manualFlows)} sub="require manual trigger" />
        <Card icon={Send} label="Total Campaigns" value={totalCampaignsDisplay} sub={totalCampaignsSub} />

        <Card
          icon={Users}
          label="List Size"
          value={formatIntWithTruncFlag(
            accountSnapshot?.total_profiles_count ?? accountSnapshot?.email_subscribed_profiles_count ?? null,
            accountSnapshot?.email_subscribed_profiles_truncated,
          )}
          sub={
            accountSnapshot?.profile_scan_status === 'skipped'
              ? 'fast audit — full profile scan not run'
              : accountSnapshot?.profile_scan_status === 'pending' && accountSnapshot?.total_profiles_count == null && accountSnapshot?.email_subscribed_profiles_count == null
                ? 'full profile scan in progress'
                : (accountSnapshot?.total_profiles_count ?? accountSnapshot?.email_subscribed_profiles_count) == null
                  ? 'requires profiles:read scope'
                  : 'all profiles in Klaviyo account'
          }
        />
        <Card
          icon={UserCheck}
          label="Active Profiles"
          value={formatIntWithTruncFlag(
            accountSnapshot?.email_subscribed_profiles_count ?? null,
            accountSnapshot?.email_subscribed_profiles_truncated,
          )}
          sub={
            accountSnapshot?.profile_scan_status === 'skipped'
              ? 'fast audit — full profile scan not run'
              : accountSnapshot?.profile_scan_status === 'pending' && accountSnapshot?.email_subscribed_profiles_count == null
                ? 'full profile scan in progress'
                : accountSnapshot?.email_subscribed_profiles_count == null
                  ? 'requires profiles:read scope'
                  : 'email-subscribed profiles'
          }
        />
        <Card
          icon={UserX}
          label="Suppressions"
          value={formatIntWithTruncFlag(
            accountSnapshot?.suppressed_profiles_count ?? null,
            accountSnapshot?.suppressed_profiles_truncated,
          )}
          sub={
            accountSnapshot?.profile_scan_status === 'skipped'
              ? 'fast audit — full profile scan not run'
              : accountSnapshot?.profile_scan_status === 'pending' && accountSnapshot?.suppressed_profiles_count == null
                ? 'full profile scan in progress'
                : accountSnapshot?.suppressed_profiles_count == null
                  ? 'requires profiles:read scope'
                  : [
                      'email marketing suppression on profile',
                      accountSnapshot?.suppressed_profiles_truncated
                        ? 'partial scan — 0 often means “not counted yet”, not “none in Klaviyo”'
                        : null,
                    ].filter(Boolean).join(' · ')
          }
        />
        <Card
          icon={Clock}
          label="Send Frequency"
          value={recentSent > 0 ? `${perWeek.toFixed(perWeek < 1 ? 1 : 0)}/wk` : '—'}
          sub={recentSent > 0 ? `${recentSent} campaigns sent (last 30 days)` : 'based on recent sent campaigns'}
        />

        <Card
          icon={MailX}
          label="Bounce Rate"
          value={accountSnapshot?.bounce_rate_90d != null ? formatRatePct(accountSnapshot.bounce_rate_90d) : 'N/A'}
          sub={
            accountSnapshot?.bounce_rate_90d != null
              ? `${accountSnapshot?.deliverability_campaign_timeframe === 'last_30_days' ? 'last 30' : 'last 90'} days · email campaigns (weighted by recipients)`
              : 'not enough campaign data available'
          }
        />
        <Card
          icon={ShieldAlert}
          label="Spam Rate"
          value={accountSnapshot?.spam_rate_90d != null ? formatRatePct(accountSnapshot.spam_rate_90d) : 'N/A'}
          sub={
            accountSnapshot?.spam_rate_90d != null
              ? `${accountSnapshot?.deliverability_campaign_timeframe === 'last_30_days' ? 'last 30' : 'last 90'} days · email campaigns (weighted by recipients)`
              : 'not enough campaign data available'
          }
        />
        <Card
          icon={TrendingUp}
          label="Flow Conv. Rate"
          value={hasPerf && weightedConv != null ? formatPct(weightedConv) : 'N/A'}
          sub={hasPerf ? 'weighted average (flows)' : perfUnavailableReason}
        />
        <Card
          icon={DollarSign}
          label="Revenue / Recipient"
          value={hasPerf && revenuePerRecipient != null ? `$${revenuePerRecipient.toFixed(2)}` : 'N/A'}
          sub={hasPerf ? 'across all flows' : perfUnavailableReason}
        />
      </div>

      <BenchmarkCallout title="Benchmark: Healthy account hygiene">
        A healthy account typically has consistent sending cadence, low complaint/bounce signals, a clear suppression strategy,
        and a clean engaged/unengaged segmentation framework. This audit will surface hygiene risks once deliverability indicators are available.
      </BenchmarkCallout>
    </div>
  );
}
