import type { FlowPerformance, KlaviyoFlowSnapshot } from '../../lib/types';

interface Props {
  snapshots: KlaviyoFlowSnapshot[];
  performance: FlowPerformance[];
  segmentCount?: number;
}

interface Category {
  name: string;
  score: number;
  maxScore: number;
  assessment: string;
}

const ESSENTIAL_FLOW_PATTERNS = [
  { label: 'Welcome', patterns: ['welcome', 'onboard'] },
  { label: 'Abandoned Cart', patterns: ['abandon', 'cart'] },
  { label: 'Browse Abandonment', patterns: ['browse'] },
  { label: 'Post-Purchase', patterns: ['post.?purchase', 'thank', 'order.?confirm', 'post.?buy'] },
  { label: 'Winback', patterns: ['winback', 'win.?back', 're.?engage', 'sunset', 'lapsed'] },
];

function flowNameMatchesAny(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some(p => new RegExp(p, 'i').test(lower));
}

function computeCategories(snapshots: KlaviyoFlowSnapshot[], performance: FlowPerformance[], segmentCount: number): Category[] {
  const totalRecipients = performance.reduce((s, f) => s + f.recipients_per_month, 0);
  const totalRevenue = performance.reduce((s, f) => s + f.monthly_revenue_current, 0);
  const annualRevenue = totalRevenue * 12;

  const weightedOpen = totalRecipients > 0
    ? performance.reduce((s, f) => s + (f.actual_open_rate ?? 0) * f.recipients_per_month, 0) / totalRecipients : 0;
  const weightedClick = totalRecipients > 0
    ? performance.reduce((s, f) => s + (f.actual_click_rate ?? 0) * f.recipients_per_month, 0) / totalRecipients : 0;
  const weightedConv = totalRecipients > 0
    ? performance.reduce((s, f) => s + (f.actual_conv_rate ?? 0) * f.recipients_per_month, 0) / totalRecipients : 0;

  const allNames = snapshots.map(f => f.name);
  const essentialPresent = ESSENTIAL_FLOW_PATTERNS.filter(e =>
    allNames.some(n => flowNameMatchesAny(n, e.patterns))
  );

  const total = snapshots.length;
  const inactive = snapshots.filter(f => ['draft', 'paused'].includes(f.status?.toLowerCase())).length;
  const inactiveRatio = total > 0 ? inactive / total : 0;

  const hasPostPurchase = allNames.some(n => flowNameMatchesAny(n, ['post.?purchase', 'thank', 'order.?confirm', 'post.?buy', 'replenish']));

  const categories: Category[] = [];

  // Revenue Generation (0-10)
  let revScore = 0;
  if (annualRevenue >= 500_000) revScore = 10;
  else if (annualRevenue >= 300_000) revScore = 8;
  else if (annualRevenue >= 200_000) revScore = 6;
  else if (annualRevenue >= 100_000) revScore = 4;
  else if (annualRevenue >= 50_000) revScore = 2;
  else revScore = 1;
  categories.push({
    name: 'Revenue Generation',
    score: revScore, maxScore: 10,
    assessment: annualRevenue >= 200_000 ? 'Strong flow revenue' : `${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(annualRevenue)} is ${annualRevenue < 100_000 ? '20-35%' : '50-70%'} of expected`,
  });

  // Flow Coverage (0-10)
  const coverageScore = Math.min(10, Math.round((essentialPresent.length / ESSENTIAL_FLOW_PATTERNS.length) * 10));
  const missing = ESSENTIAL_FLOW_PATTERNS.filter(e => !allNames.some(n => flowNameMatchesAny(n, e.patterns))).map(e => e.label.toLowerCase());
  categories.push({
    name: 'Flow Coverage',
    score: coverageScore, maxScore: 10,
    assessment: missing.length === 0 ? 'All essential flows present' : `Missing ${missing.join(', ')}`,
  });

  // Conversion Rates (0-10)
  let convScore = 0;
  if (weightedConv >= 0.05) convScore = 10;
  else if (weightedConv >= 0.03) convScore = 7;
  else if (weightedConv >= 0.02) convScore = 5;
  else if (weightedConv >= 0.01) convScore = 3;
  else if (weightedConv >= 0.005) convScore = 2;
  else convScore = 1;
  categories.push({
    name: 'Conversion Rates',
    score: convScore, maxScore: 10,
    assessment: `${(weightedConv * 100).toFixed(2)}% overall vs. 2-5% benchmark`,
  });

  // Click-Through Rates (0-10)
  let clickScore = 0;
  if (weightedClick >= 0.10) clickScore = 10;
  else if (weightedClick >= 0.06) clickScore = 7;
  else if (weightedClick >= 0.04) clickScore = 5;
  else if (weightedClick >= 0.02) clickScore = 3;
  else clickScore = 1;
  categories.push({
    name: 'Click-Through Rates',
    score: clickScore, maxScore: 10,
    assessment: `${(weightedClick * 100).toFixed(1)}% avg vs. 8-15% benchmark`,
  });

  // Open Rates (0-10)
  let openScore = 0;
  if (weightedOpen >= 0.50) openScore = 8;
  else if (weightedOpen >= 0.40) openScore = 7;
  else if (weightedOpen >= 0.30) openScore = 6;
  else if (weightedOpen >= 0.20) openScore = 4;
  else openScore = 2;
  if (weightedOpen >= 0.45) openScore = Math.min(10, openScore);
  categories.push({
    name: 'Open Rates',
    score: openScore, maxScore: 10,
    assessment: weightedOpen >= 0.40 ? 'Decent but inflated by Apple MPP' : `${(weightedOpen * 100).toFixed(1)}% avg, room for improvement`,
  });

  // Flow Hygiene (0-10)
  let hygieneScore = 10;
  if (inactiveRatio > 0.6) hygieneScore = 1;
  else if (inactiveRatio > 0.4) hygieneScore = 2;
  else if (inactiveRatio > 0.3) hygieneScore = 4;
  else if (inactiveRatio > 0.2) hygieneScore = 6;
  else if (inactiveRatio > 0.1) hygieneScore = 8;
  categories.push({
    name: 'Flow Hygiene',
    score: hygieneScore, maxScore: 10,
    assessment: inactiveRatio > 0.3 ? `${Math.round(inactiveRatio * 100)}% inactive, dead flows hurting deliverability` : `${Math.round(inactiveRatio * 100)}% inactive, acceptable`,
  });

  // Post-Purchase (0-10)
  categories.push({
    name: 'Post-Purchase',
    score: hasPostPurchase ? 6 : 0, maxScore: 10,
    assessment: hasPostPurchase ? 'Flow exists but may need optimization' : 'No active flow at all',
  });

  // Segmentation (0-10)
  let segScore = 0;
  if (segmentCount >= 20) segScore = 8;
  else if (segmentCount >= 10) segScore = 6;
  else if (segmentCount >= 5) segScore = 4;
  else if (segmentCount >= 1) segScore = 2;
  categories.push({
    name: 'Segmentation',
    score: segScore, maxScore: 10,
    assessment: segmentCount >= 10 ? 'Complex system exists, execution needs work' : `${segmentCount} segments, needs expansion`,
  });

  return categories;
}

function scoreColor(score: number, max: number): string {
  const pct = score / max;
  if (pct >= 0.7) return 'bg-emerald-500';
  if (pct >= 0.4) return 'bg-amber-400';
  return 'bg-red-400';
}

function overallLabel(score: number): { text: string; color: string } {
  if (score >= 75) return { text: 'Excellent', color: 'text-emerald-600' };
  if (score >= 55) return { text: 'Good', color: 'text-emerald-600' };
  if (score >= 35) return { text: 'Fair', color: 'text-amber-600' };
  return { text: 'Needs Major Work', color: 'text-red-500' };
}

function overallRingColor(score: number): string {
  if (score >= 75) return 'stroke-emerald-500';
  if (score >= 55) return 'stroke-emerald-400';
  if (score >= 35) return 'stroke-amber-400';
  return 'stroke-red-400';
}

export default function ReportFlowHealthScore({ snapshots, performance, segmentCount = 0 }: Props) {
  const categories = computeCategories(snapshots, performance, segmentCount);
  const totalScore = categories.reduce((s, c) => s + c.score, 0);
  const maxTotal = categories.reduce((s, c) => s + c.maxScore, 0);
  const overall = maxTotal > 0 ? Math.round((totalScore / maxTotal) * 100) : 0;
  const label = overallLabel(overall);

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (overall / 100) * circumference;

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 mb-5">Overall Flow Health Score</h3>
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex flex-col items-center shrink-0">
          <div className="relative w-36 h-36">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
              <circle
                cx="60" cy="60" r={radius} fill="none"
                className={overallRingColor(overall)}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-extrabold ${label.color}`}>{overall}</span>
              <span className="text-xs text-gray-400">/ 100</span>
            </div>
          </div>
          <p className={`text-sm font-bold mt-2 ${label.color}`}>{label.text}</p>
        </div>

        <div className="flex-1 w-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider pl-2">Category</th>
                <th className="py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider w-20">Score</th>
                <th className="py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Assessment</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(c => (
                <tr key={c.name} className="border-b border-gray-50">
                  <td className="py-2.5 pl-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${scoreColor(c.score, c.maxScore)} shrink-0`} />
                      <span className="font-medium text-gray-800">{c.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-center font-semibold text-gray-700">{c.score} / {c.maxScore}</td>
                  <td className="py-2.5 text-gray-500 text-xs">{c.assessment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
