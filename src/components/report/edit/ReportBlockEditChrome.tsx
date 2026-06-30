import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useReportEdit } from './ReportEditContext';

export default function ReportBlockEditChrome({
  label,
  hidden,
  onToggleHidden,
  children,
  className,
  hideButtonClassName,
}: {
  label: string;
  hidden?: boolean;
  onToggleHidden?: (hidden: boolean) => void;
  children: ReactNode;
  className?: string;
  hideButtonClassName?: string;
}) {
  const { editMode } = useReportEdit();
  if (!editMode || !onToggleHidden) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }

  if (hidden) {
    return (
      <div className={cn('mb-6 flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 py-3', className)}>
        <div>
          <p className="text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-500">Hidden on client report</p>
        </div>
        <button
          type="button"
          onClick={() => onToggleHidden(false)}
          title={`Show ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:text-brand-primary"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => onToggleHidden(true)}
        title={`Hide ${label}`}
        className={cn(
          'absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-500 shadow-sm backdrop-blur-sm hover:border-amber-300 hover:text-amber-700',
          hideButtonClassName,
        )}
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

export function ReportItemHideButton({
  hidden,
  onToggleHidden,
  title,
}: {
  hidden?: boolean;
  onToggleHidden: (hidden: boolean) => void;
  title: string;
}) {
  const { editMode } = useReportEdit();
  if (!editMode || hidden) return null;
  return (
    <button
      type="button"
      onClick={() => onToggleHidden(true)}
      title={title}
      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400 hover:border-amber-300 hover:text-amber-700"
    >
      <Eye className="h-3.5 w-3.5" />
    </button>
  );
}

export function ReportHiddenItemStub({
  label,
  onRestore,
}: {
  label: string;
  onRestore: () => void;
}) {
  const { editMode } = useReportEdit();
  if (!editMode) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-4 py-2.5">
      <span className="text-sm text-gray-500">{label} (hidden)</span>
      <button
        type="button"
        onClick={onRestore}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:text-brand-primary"
        title="Show on report"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
