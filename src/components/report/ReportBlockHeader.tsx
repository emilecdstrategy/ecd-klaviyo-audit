import { type ReactNode } from 'react';

export default function ReportBlockHeader({
  icon,
  title,
  subtitle,
  titleClassName = 'text-base font-bold text-gray-900',
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  titleClassName?: string;
}) {
  return (
    <div className="border-b border-gray-100 bg-gradient-to-r from-brand-surface to-white px-6 py-4">
      <div className="flex items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <h3 className={titleClassName}>{title}</h3>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
