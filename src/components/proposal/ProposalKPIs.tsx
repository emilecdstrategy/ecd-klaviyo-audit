import { useMemo, useState } from 'react';
import { FileSignature, Send, Eye, Trophy, XCircle, Percent } from 'lucide-react';
import KPICard from '../ui/KPICard';
import MonthlyBarChart from '../ui/MonthlyBarChart';
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from '../ui/select';
import { deriveProposalStatus, isProposalOpen } from '../../lib/proposal-status';
import {
  computeProposalTotals,
  proposalDiscountFromRow,
  proposalPipelineValue,
} from '../../lib/proposal-pricing';
import { formatCurrency } from '../../lib/revenue-calculator';
import type { Proposal } from '../../lib/types';

const PERIOD_OPTIONS = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
  { value: '24', label: 'Last 24 months' },
  { value: 'all', label: 'All time' },
] as const;

function monthsBetween(start: Date, end: Date): number {
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

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

/** One-time total plus 12x monthly total, for any proposal regardless of status. */
function proposalValue(proposal: Proposal): number {
  const totals = computeProposalTotals(proposal.line_items ?? [], proposalDiscountFromRow(proposal));
  return proposalPipelineValue(totals);
}

export default function ProposalKPIs({ proposals }: { proposals: Proposal[] }) {
  const [period, setPeriod] = useState<string>('6');
  const [chartMode, setChartMode] = useState<'count' | 'value'>('count');
  const statuses = proposals.map(p => deriveProposalStatus(p));
  const sentCount = proposals.filter(p => p.sent_at).length;
  const viewedCount = proposals.filter(p => p.first_viewed_at).length;
  const wonCount = statuses.filter(s => s === 'won').length;
  const lostCount = statuses.filter(s => s === 'lost').length;
  const decided = wonCount + lostCount;
  const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) : null;

  const openValue = proposals.filter(isProposalOpen).reduce((sum, p) => sum + proposalValue(p), 0);
  const wonValue = proposals
    .filter((_p, i) => statuses[i] === 'won')
    .reduce((sum, p) => sum + proposalValue(p), 0);
  const lostValue = proposals
    .filter((_p, i) => statuses[i] === 'lost')
    .reduce((sum, p) => sum + proposalValue(p), 0);

  const monthCount = useMemo(() => {
    if (period !== 'all') return Number(period);
    const earliestDates = proposals
      .map(p => p.created_at)
      .filter((d): d is string => Boolean(d))
      .map(d => new Date(d));
    if (earliestDates.length === 0) return 6;
    const earliest = new Date(Math.min(...earliestDates.map(d => d.getTime())));
    return Math.max(1, monthsBetween(earliest, new Date()) + 1);
  }, [period, proposals]);

  const months = lastMonths(monthCount);
  const chartData = months.map(month => {
    const sentProposals = proposals.filter(p => monthOf(p.sent_at) === month);
    const wonProposals = proposals.filter(p => p.status === 'won' && monthOf(p.won_at) === month);
    return {
      month,
      series: {
        sent: chartMode === 'value'
          ? sentProposals.reduce((sum, p) => sum + proposalValue(p), 0)
          : sentProposals.length,
        won: chartMode === 'value'
          ? wonProposals.reduce((sum, p) => sum + proposalValue(p), 0)
          : wonProposals.length,
      },
    };
  });

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Sent vs won</h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setChartMode('count')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    chartMode === 'count' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  Count
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode('value')}
                  className={`rounded-md px-2.5 py-1 transition ${
                    chartMode === 'value' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  Value ($)
                </button>
              </div>
              <div className="w-40 shrink-0">
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Last 6 months" />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <SelectItemText>{opt.label}</SelectItemText>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <MonthlyBarChart
            data={chartData}
            series={[
              { key: 'sent', label: 'Sent', color: '#c7c2ff' },
              { key: 'won', label: 'Won', color: '#4b3afe' },
            ]}
            formatValue={chartMode === 'value' ? formatCurrency : undefined}
          />
        </div>
        <div className="rounded-xl bg-white p-5 card-shadow">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Pipeline by status</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              All time
            </span>
          </div>
          <div className="mt-4 space-y-3">
            <PipelineRow label="Open" dotColor="bg-blue-400" value={openValue} />
            <PipelineRow label="Won" dotColor="bg-emerald-500" value={wonValue} />
            <PipelineRow label="Lost" dotColor="bg-red-400" value={lostValue} />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-xs font-semibold text-gray-500">Total</span>
            <span className="text-sm font-bold tabular-nums text-gray-900">
              {formatCurrency(openValue + wonValue + lostValue)}
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            One-time totals plus 12 months of retainers, across every proposal regardless of when it was created.
          </p>
        </div>
      </div>
    </div>
  );
}

function PipelineRow({ label, value, dotColor }: { label: string; value: number; dotColor: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-gray-600">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(value)}</span>
    </div>
  );
}
