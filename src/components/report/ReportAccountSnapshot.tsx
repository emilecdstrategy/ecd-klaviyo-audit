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
    <div className="bg-white rounded-xl p-5 border border-gray-100">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs font-medium mt-0.5 text-gray-400">{sub}</p>
    </div>
  );
}

export default function ReportAccountSnapshot({
  flowSnapshots,
  flowPerformance,
  campaignSnapshots,
  reportingDiagnostic,
}: {
  flowSnapshots: KlaviyoFlowSnapshot[];
  flowPerformance: FlowPerformance[];
  campaignSnapshots: KlaviyoCampaignSnapshot[];
  reportingDiagnostic?: string | null;
}) {
  const totalFlows = flowSnapshots.length;
  const liveFlows = flowSnapshots.filter((f) => f.status?.toLowerCase() === 'live' || f.status?.toLowerCase() === 'manual').length;
  const draftPausedFlows = flowSnapshots.filter((f) => ['draft', 'paused'].includes(f.status?.toLowerCase())).length;
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Total Flows" value={String(totalFlows)} sub="in Klaviyo account" />
        <Card label="Live Flows" value={String(liveFlows)} sub="actively sending" />
        <Card label="Draft / Paused" value={String(draftPausedFlows)} sub={`${totalFlows > 0 ? Math.round((draftPausedFlows / totalFlows) * 100) : 0}% inactive`} />
        <Card label="Manual Flows" value={String(manualFlows)} sub="require manual trigger" />

        <Card
          label="List Size"
          value="N/A"
          sub="not pulled yet (needs profiles/list metrics)"
        />
        <Card
          label="Active Profiles"
          value="N/A"
          sub="not pulled yet (needs active profile definition)"
        />
        <Card
          label="Suppressions"
          value="N/A"
          sub="not pulled yet (needs suppression metrics)"
        />
        <Card
          label="Send Frequency"
          value={recentSent > 0 ? `${perWeek.toFixed(perWeek < 1 ? 1 : 0)}/wk` : '—'}
          sub={recentSent > 0 ? `${recentSent} campaigns sent (last 30 days)` : 'based on recent sent campaigns'}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
        <Card
          label="Bounce Rate"
          value="N/A"
          sub="not pulled yet (deliverability metrics)"
        />
        <Card
          label="Spam Rate"
          value="N/A"
          sub="not pulled yet (deliverability metrics)"
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

      <div className="mt-4 bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Benchmark: Healthy account hygiene</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          A healthy account typically has consistent sending cadence, low complaint/bounce signals, a clear suppression strategy,
          and a clean engaged/unengaged segmentation framework. This audit will surface hygiene risks once deliverability indicators are available.
        </p>
      </div>
    </div>
  );
}

