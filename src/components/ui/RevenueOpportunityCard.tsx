import { TrendingUp, DollarSign } from 'lucide-react';
import { formatCurrency } from '../../lib/revenue-calculator';

interface RevenueOpportunityCardProps {
  amount: number;
  label?: string;
  confidence?: 'low' | 'medium' | 'high';
  compact?: boolean;
}

const confidenceColors = {
  low: 'text-amber-600 bg-amber-50',
  medium: 'text-blue-600 bg-blue-50',
  high: 'text-emerald-600 bg-emerald-50',
};

export default function RevenueOpportunityCard({
  amount,
  label = 'Estimated Monthly Impact',
  confidence,
  compact = false,
}: RevenueOpportunityCardProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 rounded-lg">
        <DollarSign className="w-4 h-4 text-emerald-600" />
        <span className="text-sm font-semibold text-emerald-700">{formatCurrency(amount)}</span>
        <span className="text-xs text-emerald-600">/mo</span>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-xl p-5 animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <span className="text-sm font-medium text-emerald-700">{label}</span>
        </div>
        {confidence && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${confidenceColors[confidence]}`}>
            {confidence.charAt(0).toUpperCase() + confidence.slice(1)} Confidence
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-emerald-800">
        {formatCurrency(amount)}
        <span className="text-lg font-medium text-emerald-600">/mo</span>
      </p>
    </div>
  );
}
