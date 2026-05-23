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
import { cn } from '../../lib/utils';
import type { FlowPerformance, KlaviyoCampaignSnapshot, KlaviyoFlowSnapshot } from '../../lib/types';

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

type MetricTone = 'flows' | 'audience' | 'cadence' | 'deliverability' | 'performance';

const METRIC_TONE: Record<
  MetricTone,
  { card: string; iconWrap: string; icon: string; label: string }
> = {
  flows: {
    card: 'border-indigo-100/80 bg-gradient-to-br from-indigo-50/40 to-white',
    iconWrap: 'bg-indigo-100/80',
    icon: 'text-indigo-600',
    label: 'text-indigo-900/55',
  },
  audience: {
    card: 'border-violet-100/80 bg-gradient-to-br from-violet-50/50 to-white',
    iconWrap: 'bg-brand-primary/10',
    icon: 'text-brand-primary',
    label: 'text-brand-navy/55',
  },
  cadence: {
    card: 'border-brand-primary/10 bg-gradient-to-br from-brand-surface to-white',
    iconWrap: 'bg-brand-primary/10',
    icon: 'text-brand-primary-dark',
    label: 'text-gray-500',
  },
  deliverability: {
    card: 'border-slate-200/80 bg-gradient-to-br from-slate-50/70 to-white',
    iconWrap: 'bg-slate-100',
    icon: 'text-slate-600',
    label: 'text-slate-600/70',
  },
  performance: {
    card: 'border-emerald-100/80 bg-gradient-to-br from-emerald-50/35 to-white',
    iconWrap: 'bg-emerald-100/70',
    icon: 'text-emerald-700',
    label: 'text-emerald-900/50',
  },
};

function Card({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'audience',
}: {
  label: string;
  value: string;
  sub: string;
  icon?: LucideIcon;
  tone?: MetricTone;
}) {
  const palette = METRIC_TONE[tone];
  return (
    <div className={cn('rounded-xl border px-4 py-4 shadow-sm', palette.card)}>
      <div className="mb-2 flex items-center gap-2">
        {Icon && (
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', palette.iconWrap)}>
            <Icon className={cn('h-3.5 w-3.5', palette.icon)} strokeWidth={2} />
          </div>
        )}
        <p className={cn('text-[10px] font-bold uppercase tracking-wider', palette.label)}>{label}</p>
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-900">{value}</p>
      <p className="mt-1.5 text-xs leading-snug text-gray-500">{sub}</p>
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
    deliverability_campaign_timeframe?: 'last_30_days' | 'last_90_days' | null;
    profile_scan_status?: 'pending' | 'complete' | 'failed' | 'skipped' | null;
  } | null;
}) {
  const totalFlows = flowSnapshots.length;
  const liveFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const totalCampaigns = campaignSnapshots.length;
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
        <Card tone="flows" icon={Workflow} label="Total Flows" value={String(totalFlows)} sub="in Klaviyo account" />
        <Card tone="flows" icon={Zap} label="Live Flows" value={String(liveFlows)} sub="actively sending" />
        <Card tone="flows" icon={MousePointerClick} label="Manual Flows" value={String(manualFlows)} sub="require manual trigger" />
        <Card tone="flows" icon={Send} label="Total Campaigns" value={String(totalCampaigns)} sub="email campaigns in account" />

        <Card
          tone="audience"
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
          tone="audience"
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
          tone="audience"
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
          tone="cadence"
          icon={Clock}
          label="Send Frequency"
          value={recentSent > 0 ? `${perWeek.toFixed(perWeek < 1 ? 1 : 0)}/wk` : '—'}
          sub={recentSent > 0 ? `${recentSent} campaigns sent (last 30 days)` : 'based on recent sent campaigns'}
        />

        <Card
          tone="deliverability"
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
          tone="deliverability"
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
          tone="performance"
          icon={TrendingUp}
          label="Flow Conv. Rate"
          value={hasPerf && weightedConv != null ? formatPct(weightedConv) : 'N/A'}
          sub={hasPerf ? 'weighted average (flows)' : perfUnavailableReason}
        />
        <Card
          tone="performance"
          icon={DollarSign}
          label="Revenue / Recipient"
          value={hasPerf && revenuePerRecipient != null ? `$${revenuePerRecipient.toFixed(2)}` : 'N/A'}
          sub={hasPerf ? 'across all flows' : perfUnavailableReason}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-brand-primary/15 bg-gradient-to-br from-brand-surface via-white to-white">
        <div className="border-l-4 border-brand-primary px-5 py-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary">
            Benchmark: Healthy account hygiene
          </p>
          <p className="text-sm leading-relaxed text-gray-600">
            A healthy account typically has consistent sending cadence, low complaint/bounce signals, a clear suppression strategy,
            and a clean engaged/unengaged segmentation framework. This audit will surface hygiene risks once deliverability indicators are available.
          </p>
        </div>
      </div>
    </div>
  );
}
