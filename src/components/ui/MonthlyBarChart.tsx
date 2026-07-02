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

function monthLabel(month: string): string {
  const idx = Number(month.slice(5, 7)) - 1;
  return MONTH_LABELS[idx] ?? month;
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
  const maxValue = Math.max(
    1,
    ...data.flatMap(d => series.map(s => d.series[s.key] ?? 0)),
  );
  const bandWidth = (width - padX * 2) / Math.max(data.length, 1);
  const barGap = 4;
  const barWidth = Math.min(28, (bandWidth - barGap * (series.length + 1)) / series.length);
  const gridLines = [0.25, 0.5, 0.75, 1];
  const allZero = data.every(d => series.every(s => (d.series[s.key] ?? 0) === 0));

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
        {gridLines.map(frac => {
          const y = padTop + chartHeight * (1 - frac);
          return (
            <g key={frac}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
              <text x={padX} y={y - 3} className="fill-gray-300" fontSize={9}>
                {formatValue(Math.round(maxValue * frac))}
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
                const barH = Math.max(value > 0 ? 3 : 2, (value / maxValue) * chartHeight);
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
              <text
                x={bandX + bandWidth / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-gray-400"
                fontSize={10}
              >
                {monthLabel(d.month)}
              </text>
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

      {hoverIndex !== null && data[hoverIndex] && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg border border-gray-100 bg-white px-3 py-1.5 text-xs shadow-md"
          style={{ left: `${((padX + (hoverIndex + 0.5) * bandWidth) / width) * 100}%` }}
        >
          <span className="font-semibold text-gray-800">{monthLabel(data[hoverIndex].month)}</span>
          {series.map(s => (
            <span key={s.key} className="ml-2 text-gray-500">
              {formatValue(data[hoverIndex].series[s.key] ?? 0)} {s.label.toLowerCase()}
            </span>
          ))}
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
