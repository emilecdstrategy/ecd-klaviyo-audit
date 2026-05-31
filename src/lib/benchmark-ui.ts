import type { MetricStatus } from './benchmarks';

export type BenchmarkDirection = 'higher' | 'lower';

export interface MetricStatusStyles {
  chip: string;
  icon: string;
  value: string;
  badge: string;
}

const STATUS_STYLES: Record<MetricStatus, MetricStatusStyles> = {
  good: {
    chip: 'bg-emerald-50',
    icon: 'text-emerald-600',
    value: 'text-emerald-700',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  warning: {
    chip: 'bg-amber-50',
    icon: 'text-amber-600',
    value: 'text-amber-700',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  bad: {
    chip: 'bg-red-50',
    icon: 'text-red-600',
    value: 'text-red-700',
    badge: 'bg-red-50 text-red-700 border-red-200',
  },
  missing: {
    chip: 'bg-gray-100',
    icon: 'text-gray-500',
    value: 'text-gray-900',
    badge: 'bg-gray-50 text-gray-500 border-gray-200',
  },
};

export function metricStatusStyles(status: MetricStatus): MetricStatusStyles {
  return STATUS_STYLES[status];
}

export function formatStatusBadgeLabel(status: MetricStatus, direction: BenchmarkDirection): string {
  if (status === 'missing') return '';
  if (direction === 'lower') {
    if (status === 'good') return 'Within benchmark';
    if (status === 'warning') return 'Elevated';
    return 'Needs attention';
  }
  if (status === 'good') return 'Within benchmark';
  if (status === 'warning') return 'Below benchmark';
  return 'Needs attention';
}
