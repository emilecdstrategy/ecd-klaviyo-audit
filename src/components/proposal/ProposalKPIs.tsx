import { FileSignature, Send, Eye, Trophy, XCircle, Percent, TrendingUp } from 'lucide-react';
import KPICard from '../ui/KPICard';
import MonthlyBarChart from '../ui/MonthlyBarChart';
import { deriveProposalStatus, isProposalOpen } from '../../lib/proposal-status';
import {
  computeProposalTotals,
  proposalDiscountFromRow,
  proposalPipelineValue,
} from '../../lib/proposal-pricing';
import { formatCurrency } from '../../lib/revenue-calculator';
import type { Proposal } from '../../lib/types';

function lastMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function monthOf(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

export default function ProposalKPIs({ proposals }: { proposals: Proposal[] }) {
  const statuses = proposals.map(p => deriveProposalStatus(p));
  const sentCount = proposals.filter(p => p.sent_at).length;
  const viewedCount = proposals.filter(p => p.first_viewed_at).length;
  const wonCount = statuses.filter(s => s === 'won').length;
  const lostCount = statuses.filter(s => s === 'lost').length;
  const decided = wonCount + lostCount;
  const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) : null;

  const pipelineValue = proposals
    .filter(isProposalOpen)
    .reduce((sum, p) => {
      const totals = computeProposalTotals(p.line_items ?? [], proposalDiscountFromRow(p));
      return sum + proposalPipelineValue(totals);
    }, 0);

  const months = lastMonths(6);
  const chartData = months.map(month => ({
    month,
    series: {
      sent: proposals.filter(p => monthOf(p.sent_at) === month).length,
      won: proposals.filter(p => p.status === 'won' && monthOf(p.won_at) === month).length,
    },
  }));

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KPICard label="Total" value={proposals.length} icon={FileSignature} accent="primary" />
        <KPICard label="Sent" value={sentCount} icon={Send} accent="primary" />
        <KPICard label="Viewed" value={viewedCount} icon={Eye} accent="warning" />
        <KPICard label="Won" value={wonCount} icon={Trophy} accent="success" />
        <KPICard label="Lost" value={lostCount} icon={XCircle} accent="warning" />
        <KPICard
          label="Win rate"
          value={winRate === null ? '—' : `${winRate}%`}
          icon={Percent}
          accent="secondary"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-5 card-shadow lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Sent vs won</h3>
          <p className="mb-3 text-xs text-gray-400">Last 6 months</p>
          <MonthlyBarChart
            data={chartData}
            series={[
              { key: 'sent', label: 'Sent', color: '#c7c2ff' },
              { key: 'won', label: 'Won', color: '#4b3afe' },
            ]}
          />
        </div>
        <div className="flex flex-col justify-between rounded-xl bg-white p-5 card-shadow">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Open pipeline</h3>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <TrendingUp className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-3xl font-extrabold tracking-tight text-gray-900 tabular-nums">
              {formatCurrency(pipelineValue)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              Value of open (sent/viewed) proposals: one-time totals plus 12 months of retainers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
