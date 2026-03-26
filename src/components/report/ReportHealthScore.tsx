import type { HealthScoreItem } from '../../lib/types';

interface ReportHealthScoreProps {
  scores: HealthScoreItem[];
}

function statusColor(status: HealthScoreItem['status']) {
  if (status === 'good') return { ring: '#10b981', text: 'text-emerald-600', bg: 'bg-emerald-500', dot: 'bg-emerald-500' };
  if (status === 'warning') return { ring: '#f59e0b', text: 'text-amber-600', bg: 'bg-amber-400', dot: 'bg-amber-400' };
  return { ring: '#ef4444', text: 'text-red-600', bg: 'bg-red-400', dot: 'bg-red-400' };
}

export default function ReportHealthScore({ scores }: ReportHealthScoreProps) {
  const totalScore = scores.reduce((s, item) => s + item.score, 0);
  const totalMax = scores.reduce((s, item) => s + item.max_score, 0);
  const overallPct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  const overallStatus: HealthScoreItem['status'] = overallPct >= 70 ? 'good' : overallPct >= 45 ? 'warning' : 'bad';
  const colors = statusColor(overallStatus);

  const circumference = 2 * Math.PI * 44;
  const dashOffset = circumference - (overallPct / 100) * circumference;

  const goodCount = scores.filter(s => s.status === 'good').length;
  const warningCount = scores.filter(s => s.status === 'warning').length;
  const badCount = scores.filter(s => s.status === 'bad').length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
        <div className="p-8 flex flex-col items-center justify-center">
          <svg width="120" height="120" viewBox="0 0 100 100" className="mb-4">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#f3f4f6" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={colors.ring}
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
            <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="800" fill="#111827">{overallPct}</text>
            <text x="50" y="62" textAnchor="middle" fontSize="11" fill="#9ca3af">/ 100</text>
          </svg>
          <p className="text-sm font-semibold text-gray-900 mb-1">Overall Health Score</p>
          <p className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}>
            {overallStatus === 'good' ? 'Good' : overallStatus === 'warning' ? 'Needs Attention' : 'Critical Issues'}
          </p>
          <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{goodCount} good</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{warningCount} warning</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{badCount} critical</span>
          </div>
        </div>

        <div className="col-span-2 p-6">
          <div className="space-y-3">
            {scores.map(item => {
              const pct = item.max_score > 0 ? (item.score / item.max_score) * 100 : 0;
              const c = statusColor(item.status);
              return (
                <div key={item.category}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.dot} shrink-0`} />
                      <span className="text-sm font-medium text-gray-800">{item.category}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs font-bold ${c.text}`}>{item.score}/{item.max_score}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${c.bg} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 leading-tight w-72 hidden lg:block">{item.note}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
