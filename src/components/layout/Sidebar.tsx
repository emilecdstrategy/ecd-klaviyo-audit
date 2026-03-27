import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  ClipboardCheck,
  Plus,
  Settings,
  Zap,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/audits', icon: ClipboardCheck, label: 'Audits' },
  { to: '/audits/new', icon: Plus, label: 'New Audit' },
];

const ADMIN_ITEMS = [
  { to: '/admin', icon: Settings, label: 'Admin' },
];

export default function Sidebar({ collapsed: collapsedProp, onCollapsedChange }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsedState, setCollapsedState] = useState(false);
  const collapsed = collapsedProp ?? collapsedState;
  const setCollapsed = (next: boolean) => {
    onCollapsedChange?.(next);
    if (collapsedProp === undefined) setCollapsedState(next);
  };
  const { user, isDemo, hasRole, signOut, exitDemo } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileAreaRef = useRef<HTMLDivElement>(null);
  const initials = (user?.name || user?.email || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join('') || 'U';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-brand-primary/10 text-brand-primary'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`;

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (profileAreaRef.current && !profileAreaRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [profileMenuOpen]);

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-100 flex flex-col z-30 transition-all duration-300 ${
        collapsed ? 'w-[68px]' : 'w-[240px]'
      }`}
    >
      <Link
        to="/"
        className="flex items-center gap-2.5 px-4 h-16 border-b border-gray-100 shrink-0 hover:bg-gray-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/30 focus-visible:ring-inset"
        aria-label="Go to Dashboard"
      >
        <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <span className="font-bold text-sm text-gray-900 whitespace-nowrap">ECD Audit</span>
            <span className="block text-[10px] text-gray-400 -mt-0.5">Klaviyo Audits</span>
          </div>
        )}
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => {
          if (item.to === '/audits/new') {
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => {
                  const clientMatch = location.pathname.match(/^\/clients\/([^/]+)$/);
                  const clientId = clientMatch?.[1];
                  navigate('/audits/new', { state: { backgroundLocation: location, ...(clientId && { clientId }) } });
                }}
                className={`${linkClass({ isActive: false })} w-full`}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          }
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClass}>
              <item.icon className="w-[18px] h-[18px] shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}

        {hasRole('admin') && (
          <>
            <div className={`pt-4 pb-1 ${collapsed ? 'px-0' : 'px-1'}`}>
              {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Admin</span>}
            </div>
            {ADMIN_ITEMS.map(item => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <div ref={profileAreaRef} className="border-t border-gray-100 p-3 relative">
        {user && (
          <>
            <button
              type="button"
              onClick={() => setProfileMenuOpen(o => !o)}
              className={`flex items-center gap-3 rounded-lg w-full text-left transition-colors ${
                collapsed ? 'justify-center px-1 py-2' : 'px-2 py-2'
              } bg-gray-50 hover:bg-gray-100 ${profileMenuOpen ? 'ring-2 ring-brand-primary/20' : ''}`}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-label="Account menu"
            >
              <div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold shrink-0">
                {initials}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  {isDemo && (
                    <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-brand-primary/10 text-brand-primary">
                      Demo Mode
                    </span>
                  )}
                </div>
              )}
            </button>

            {profileMenuOpen && (
              <div
                className="absolute bottom-full left-3 right-3 mb-1 py-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left rounded-md mx-0.5"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    if (isDemo) exitDemo();
                    else signOut();
                  }}
                >
                  <LogOut className="w-4 h-4 shrink-0 text-gray-400" />
                  <span>{isDemo ? 'Exit demo' : 'Sign out'}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors shadow-sm"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </aside>
  );
}
