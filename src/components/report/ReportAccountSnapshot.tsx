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

function formatInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return 'N/A';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
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

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 tracking-tight">{value}</p>
      <p className="text-xs font-medium mt-1 leading-snug text-gray-500">{sub}</p>
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
    email_subscribed_profiles_count: number | null;
    active_profiles_90d_count: number | null;
    suppressed_profiles_count: number | null;
    bounce_rate_90d: number | null;
    spam_rate_90d: number | null;
    active_profiles_definition?: string | null;
    computed_at?: string | null;
  } | null;
}) {
  const totalFlows = flowSnapshots.length;
  const liveFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const totalCampaigns = campaignSnapshots.length;
  const manualFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'manual' || f.trigger_type === 'Unconfigured').length;

  const hasPerf = flowPerformance.length > 0;
  const annualFlowRevenue = hasPerf ? flowPerformance.reduce((s, f) => s + (f.monthly_revenue_current ?? 0), 0) * 12 : null;
  const totalRecipients = hasPerf ? flowPerformance.reduce((s, f) => s + (f.recipients_per_month ?? 0), 0) : null;
  const weightedConv = hasPerf && totalRecipients && totalRecipients > 0
    ? flowPerformance.reduce((s, f) => s + (f.actual_conv_rate ?? 0) * (f.recipients_per_month ?? 0), 0) / totalRecipients
    : null;
  const revenuePerRecipient = hasPerf && totalRecipients && totalRecipients > 0
    ? (flowPerformance.reduce((s, f) => s + (f.monthly_revenue_current ?? 0), 0) / totalRecipients)
    : null;

  const perfUnavailableReason = normalizeReportingDiagnostic(reportingDiagnostic) || 'requires Klaviyo metrics scope';
  const { recentSent, perWeek } = calcWeeklySendFrequency(campaignSnapshots);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card label="Total Flows" value={String(totalFlows)} sub="in Klaviyo account" />
        <Card label="Live Flows" value={String(liveFlows)} sub="actively sending" />
        <Card label="Total Campaigns" value={String(totalCampaigns)} sub="email campaigns in account" />
        <Card label="Manual Flows" value={String(manualFlows)} sub="require manual trigger" />

        <Card
          label="List Size"
          value={formatInt(accountSnapshot?.email_subscribed_profiles_count ?? null)}
          sub={accountSnapshot?.email_subscribed_profiles_count != null ? 'email-subscribed profiles' : 'requires profiles:read scope'}
        />
        <Card
          label="Active Profiles"
          value={formatInt(accountSnapshot?.active_profiles_90d_count ?? null)}
          sub={accountSnapshot?.active_profiles_90d_count != null
            ? (accountSnapshot?.active_profiles_definition ?? 'engaged last 90 days')
            : 'requires profiles:read scope'}
        />
        <Card
          label="Suppressions"
          value={formatInt(accountSnapshot?.suppressed_profiles_count ?? null)}
          sub={accountSnapshot?.suppressed_profiles_count != null ? 'globally suppressed profiles' : 'requires profiles:read scope'}
        />
        <Card
          label="Send Frequency"
          value={recentSent > 0 ? `${perWeek.toFixed(perWeek < 1 ? 1 : 0)}/wk` : '—'}
          sub={recentSent > 0 ? `${recentSent} campaigns sent (last 30 days)` : 'based on recent sent campaigns'}
        />

        <Card
          label="Bounce Rate"
          value={accountSnapshot?.bounce_rate_90d != null ? formatPct(accountSnapshot.bounce_rate_90d) : 'N/A'}
          sub={accountSnapshot?.bounce_rate_90d != null ? 'last 90 days (email campaigns)' : 'requires campaigns:read scope'}
        />
        <Card
          label="Spam Rate"
          value={accountSnapshot?.spam_rate_90d != null ? formatPct(accountSnapshot.spam_rate_90d) : 'N/A'}
          sub={accountSnapshot?.spam_rate_90d != null ? 'last 90 days (email campaigns)' : 'requires campaigns:read scope'}
        />
        <Card
          label="Flow Conv. Rate"
          value={hasPerf && weightedConv != null ? formatPct(weightedConv) : 'N/A'}
          sub={hasPerf ? 'weighted average (flows)' : perfUnavailableReason}
        />
        <Card
          label="Revenue / Recipient"
          value={hasPerf && revenuePerRecipient != null ? `$${revenuePerRecipient.toFixed(2)}` : 'N/A'}
          sub={hasPerf ? 'across all flows' : perfUnavailableReason}
        />
      </div>

      <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/80 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Benchmark: Healthy account hygiene</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          A healthy account typically has consistent sending cadence, low complaint/bounce signals, a clear suppression strategy,
          and a clean engaged/unengaged segmentation framework. This audit will surface hygiene risks once deliverability indicators are available.
        </p>
      </div>
    </div>
  );
}

