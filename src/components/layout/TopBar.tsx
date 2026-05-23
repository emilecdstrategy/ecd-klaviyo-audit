import GlobalSearch from '../ui/GlobalSearch';

interface TopBarProps {
  title: string;
  subtitle?: string;
  leadingIcon?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, leadingIcon, actions }: TopBarProps) {
  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-8 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {leadingIcon}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 -mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {actions}

        <GlobalSearch />
      </div>
    </header>
  );
}
