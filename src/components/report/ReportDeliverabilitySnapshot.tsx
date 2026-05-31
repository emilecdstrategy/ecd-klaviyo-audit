import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { DeliverabilitySnapshot } from '../../lib/deliverability';
import {
  KLAVIYO_DELIVERABILITY_THRESHOLDS,
  computeDeliverabilityScore,
  formatDeliverabilityRate,
  meetsRecommended,
} from '../../lib/deliverability';

function DeliverabilityGauge({
  score,
  ringClassName,
  scoreTextClassName,
}: {
  score: number;
  ringClassName: string;
  scoreTextClassName: string;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;

  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          className={ringClassName}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-extrabold tabular-nums ${scoreTextClassName}`}>{score}</span>
        <span className="text-xs text-gray-400">/ 100</span>
      </div>
    </div>
  );
}

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.5} />;
  }
  if (ok === false) {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2.5} />;
  }
  return <XCircle className="h-4 w-4 shrink-0 text-gray-300" strokeWidth={2} />;
}

export default function ReportDeliverabilitySnapshot({
  deliverability,
}: {
  deliverability?: DeliverabilitySnapshot | null;
}) {
  if (!deliverability) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">Deliverability data is not available for this audit yet.</p>
      </div>
    );
  }

  const scoreResult = computeDeliverabilityScore(deliverability);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4">
        <h3 className="text-base font-bold text-gray-900">Deliverability score</h3>
        <p className="text-xs text-gray-500">Based on last 30 days of data</p>
      </div>

      <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row lg:items-center">
        <div className="flex items-center gap-5">
          <DeliverabilityGauge
            score={scoreResult.score}
            ringClassName={scoreResult.ringClassName}
            scoreTextClassName={scoreResult.scoreTextClassName}
          />
          <div>
            <p className="text-sm text-gray-600">
              Your score is{' '}
              <span className={`inline-flex rounded-md px-2 py-0.5 text-sm font-semibold ${scoreResult.gradeClassName}`}>
                {scoreResult.grade}
              </span>
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Computed from email campaign performance vs Klaviyo recommended thresholds
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <th className="pb-3 pr-4 font-bold">Metrics</th>
              <th className="pb-3 pr-4 font-bold">Rate</th>
              <th className="pb-3 font-bold underline decoration-dashed decoration-gray-300 underline-offset-4">
                Recommended
              </th>
            </tr>
          </thead>
          <tbody>
            {KLAVIYO_DELIVERABILITY_THRESHOLDS.map((threshold) => {
              const rate = deliverability[threshold.key];
              const ok = meetsRecommended(rate, threshold);
              return (
                <tr key={threshold.key} className="border-b border-gray-50 last:border-0">
                  <td className="py-3.5 pr-4">
                    <div className="flex items-center gap-2.5">
                      <StatusIcon ok={ok} />
                      <span className="font-medium text-gray-800">{threshold.label}</span>
                    </div>
                  </td>
                  <td className="py-3.5 pr-4 tabular-nums font-semibold text-gray-900">
                    {formatDeliverabilityRate(rate)}
                  </td>
                  <td className="py-3.5 tabular-nums text-gray-500">{threshold.recommendedLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
