import type { LucideIcon } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string | number;
  change?: string;
  icon: LucideIcon;
  accent?: 'primary' | 'secondary' | 'success' | 'warning';
}

const accentStyles = {
  primary: 'bg-brand-primary/10 text-brand-primary',
  secondary: 'bg-emerald-50 text-emerald-700',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
};

export default function KPICard({ label, value, change, icon: Icon, accent = 'primary' }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl p-5 card-shadow hover:card-shadow-hover transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {change && (
            <p className="text-xs text-emerald-600 font-medium mt-1">{change}</p>
          )}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accentStyles[accent]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}
