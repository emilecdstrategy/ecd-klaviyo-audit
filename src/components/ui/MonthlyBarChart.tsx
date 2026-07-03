import { useState } from 'react';

type SeriesDef = { key: string; label: string; color: string };

type MonthlyBarChartProps = {
  /** One entry per month, oldest first. month = '2026-01'. */
  data: Array<{ month: string; series: Record<string, number> }>;
  series: SeriesDef[];
  height?: number;
  formatValue?: (n: number) => string;
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(month: string, includeYear: boolean): string {
  const [year, m] = month.split('-');
  const idx = Number(m) - 1;
  const base = MONTH_LABELS[idx] ?? month;
  return includeYear ? `${base} '${year.slice(2)}` : base;
}

function monthLabelFull(month: string): string {
  const [year, m] = month.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_LABELS[idx] ?? month} ${year}`;
}

/** 1/2/5 * 10^n candidate steps, generated up to a magnitude comfortably above any
 * proposal dollar value so the same tick logic works for both counts and currency. */
function niceStepCandidates(): number[] {
  const steps: number[] = [];
  for (let magnitude = 1; magnitude <= 10_000_000; magnitude *= 10) {
    steps.push(magnitude, magnitude * 2, magnitude * 5);
  }
  return steps;
}
const STEP_CANDIDATES = niceStepCandidates();

/** Round-number y-axis ticks (0, step, 2*step, ...) sized so labels never repeat. */
function computeTicks(maxValue: number): number[] {
  const rounded = Math.max(1, Math.ceil(maxValue));
  const step = STEP_CANDIDATES.find(s => rounded / s <= 4) ?? STEP_CANDIDATES[STEP_CANDIDATES.length - 1];
  const top = Math.ceil(rounded / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/** Dependency-free grouped bar chart (SVG). */
export default function MonthlyBarChart({
  data,
  series,
  height = 200,
  formatValue = n => String(n),
}: MonthlyBarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 640;
  const padTop = 12;
  const padBottom = 24;
  const padX = 8;
  const chartHeight = height - padTop - padBottom;
  const rawMax = Math.max(0, ...data.flatMap(d => series.map(s => d.series[s.key] ?? 0)));
  const ticks = computeTicks(rawMax);
  const axisMax = ticks[ticks.length - 1];
  const bandWidth = (width - padX * 2) / Math.max(data.length, 1);
  const barGap = 4;
  const barWidth = Math.min(28, (bandWidth - barGap * (series.length + 1)) / series.length);
  const allZero = rawMax === 0;
  const spansMultipleYears = new Set(data.map(d => d.month.slice(0, 4))).size > 1;
  const showEveryLabel = data.length <= 12;
  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipLeftPct = hoverIndex !== null
    ? Math.min(88, Math.max(12, ((padX + (hoverIndex + 0.5) * bandWidth) / width) * 100))
    : 0;

  return (
    <div className="relative">
      <div className="mb-3 flex items-center gap-4">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Monthly chart">
        {ticks.map(tick => {
          const y = padTop + chartHeight * (1 - tick / axisMax);
          return (
            <g key={tick}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={padX} y={y - 3} className="fill-gray-300" fontSize={9}>
                {formatValue(tick)}
              </text>
            </g>
          );
        })}
        <line
          x1={padX}
          x2={width - padX}
          y1={padTop + chartHeight}
          y2={padTop + chartHeight}
          stroke="#e5e7eb"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const bandX = padX + i * bandWidth;
          const groupWidth = series.length * barWidth + (series.length - 1) * barGap;
          const startX = bandX + (bandWidth - groupWidth) / 2;
          const dim = hoverIndex !== null && hoverIndex !== i;
          return (
            <g key={d.month} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
              {series.map((s, si) => {
                const value = d.series[s.key] ?? 0;
                const barH = Math.max(value > 0 ? 3 : 2, (value / axisMax) * chartHeight);
                return (
                  <rect
                    key={s.key}
                    x={startX + si * (barWidth + barGap)}
                    y={padTop + chartHeight - barH}
                    width={barWidth}
                    height={barH}
                    rx={3}
                    fill={value > 0 ? s.color : '#f3f4f6'}
                  />
                );
              })}
              {(showEveryLabel || i % Math.ceil(data.length / 12) === 0) && (
                <text
                  x={bandX + bandWidth / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-gray-400"
                  fontSize={10}
                >
                  {monthLabel(d.month, spansMultipleYears)}
                </text>
              )}
              <rect
                x={bandX}
                y={0}
                width={bandWidth}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -top-1 z-10 min-w-[7rem] -translate-x-1/2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs shadow-md"
          style={{ left: `${tooltipLeftPct}%` }}
        >
          <p className="mb-1 font-semibold text-gray-800">{monthLabelFull(hovered.month)}</p>
          <div className="space-y-0.5">
            {series.map(s => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-gray-500">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-gray-800">
                  {formatValue(hovered.series[s.key] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {allZero && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          No proposals yet
        </p>
      )}
    </div>
  );
}
