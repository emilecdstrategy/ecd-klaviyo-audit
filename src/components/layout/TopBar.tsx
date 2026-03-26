import { Bell, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, actions }: TopBarProps) {
  const { user, isDemo } = useAuth();

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8 shrink-0">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 -mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {actions}

        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search..."
            className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 w-52 transition-all"
          />
        </div>

        <button className="relative p-2 rounded-lg hover:bg-gray-50 transition-colors">
          <Bell className="w-[18px] h-[18px] text-gray-500" />
          {isDemo && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-primary rounded-full" />
          )}
        </button>

        <div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-semibold">
          {user?.name?.split(' ').map(n => n[0]).join('') || 'U'}
        </div>
      </div>
    </header>
  );
}
