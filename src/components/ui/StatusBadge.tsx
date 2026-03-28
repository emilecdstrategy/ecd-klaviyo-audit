import { STATUS_COLORS } from '../../lib/constants';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const labels: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  published: 'Published',
  approved: 'Approved',
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${colors.bg} ${colors.text} ${sizeClasses}`}>
      {labels[status] || status}
    </span>
  );
}
