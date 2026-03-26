import { useState } from 'react';
import { ChevronDown, Zap, Clock, Target } from 'lucide-react';
import type { Recommendation } from '../../lib/types';

interface Tier {
  key: Recommendation['tier'];
  label: string;
  description: string;
  icon: typeof Zap;
  headerCls: string;
  badgeCls: string;
  borderCls: string;
}

const TIERS: Tier[] = [
  {
    key: 'quick_win',
    label: 'Quick Wins',
    description: 'High-impact changes you can implement this week',
    icon: Zap,
    headerCls: 'bg-emerald-50 border-emerald-200',
    badgeCls: 'bg-emerald-100 text-emerald-700',
    borderCls: 'border-l-emerald-500',
  },
  {
    key: 'medium',
    label: 'Medium Projects',
    description: '1–2 week implementations with strong ROI',
    icon: Clock,
    headerCls: 'bg-amber-50 border-amber-200',
    badgeCls: 'bg-amber-100 text-amber-700',
    borderCls: 'border-l-amber-500',
  },
  {
    key: 'strategic',
    label: 'Strategic Initiatives',
    description: 'Longer-term investments that compound over time',
    icon: Target,
    headerCls: 'bg-blue-50 border-blue-200',
    badgeCls: 'bg-blue-100 text-blue-700',
    borderCls: 'border-l-brand-primary border-l-[#4b3afe]',
  },
];

interface ReportRecommendationsProps {
  recommendations: Recommendation[];
}

export default function ReportRecommendations({ recommendations }: ReportRecommendationsProps) {
  const [expanded, setExpanded] = useState<string | null>('quick_win');

  return (
    <div className="space-y-3">
      {TIERS.map(tier => {
        const items = recommendations
          .filter(r => r.tier === tier.key)
          .sort((a, b) => a.sort_order - b.sort_order);

        if (items.length === 0) return null;

        const Icon = tier.icon;
        const isOpen = expanded === tier.key;

        return (
          <div key={tier.key} className="rounded-xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setExpanded(isOpen ? null : tier.key)}
              className={`w-full flex items-center justify-between px-5 py-4 border-b ${tier.headerCls} text-left transition-colors`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${tier.badgeCls}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{tier.label}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tier.badgeCls}`}>
                      {items.length}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{tier.description}</p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="divide-y divide-gray-50">
                {items.map(rec => (
                  <div key={rec.id} className={`px-5 py-4 border-l-4 ${tier.borderCls} bg-white`}>
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h4 className="text-sm font-semibold text-gray-900">{rec.title}</h4>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                          {rec.impact}
                        </span>
                        <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                          {rec.effort}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{rec.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
