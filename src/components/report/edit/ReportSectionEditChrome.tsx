import type { ReactNode } from 'react';
import { Eye, EyeOff, Palette, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useReportEdit } from './ReportEditContext';

type ActionButton = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: 'icon' | 'primary';
};

export default function ReportSectionEditChrome({
  label,
  hidden,
  onToggleHidden,
  actions,
  children,
}: {
  label: string;
  hidden: boolean;
  onToggleHidden: (hidden: boolean) => void;
  actions?: ActionButton[];
  children: ReactNode;
}) {
  const { editMode } = useReportEdit();
  if (!editMode) return <>{children}</>;

  if (hidden) {
    return (
      <div className="mb-8 flex items-center justify-between gap-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/90 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">Hidden on the client report</p>
        </div>
        <button
          type="button"
          onClick={() => onToggleHidden(false)}
          title="Show section on report"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:border-brand-primary/30 hover:text-brand-primary transition-colors"
        >
          <EyeOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute right-0 top-0 z-20 flex items-center gap-1.5">
        {actions?.map(action => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            title={action.label}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/95 text-gray-700 shadow-sm backdrop-blur-sm hover:border-brand-primary/30 hover:text-brand-primary transition-colors',
              action.variant === 'primary' ? 'px-3 py-1.5 text-xs font-semibold' : 'h-9 w-9 justify-center',
            )}
          >
            <action.icon className="h-4 w-4" />
            {action.variant === 'primary' ? <span>{action.label}</span> : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onToggleHidden(true)}
          title="Hide section from report"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white/95 text-gray-600 shadow-sm backdrop-blur-sm',
            'hover:border-amber-300 hover:text-amber-700 transition-colors',
          )}
        >
          <Eye className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

export function emailDesignAction(onManage: () => void): ActionButton {
  return {
    icon: Palette,
    label: 'Edit email design',
    onClick: onManage,
    variant: 'primary',
  };
}

export function revenueOpportunitiesAction(onManage: () => void): ActionButton {
  return {
    icon: TrendingUp,
    label: 'Manage opportunities',
    onClick: onManage,
    variant: 'primary',
  };
}
