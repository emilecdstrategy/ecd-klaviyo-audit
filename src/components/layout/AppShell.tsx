import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import DemoBanner from '../ui/DemoBanner';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useMemo, useState } from 'react';

export default function AppShell() {
  const { isDemo } = useAuth();
  const location = useLocation();
  const isAuditWorkspace = useMemo(() => /^\/audits\/[^/]+$/.test(location.pathname), [location.pathname]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Default collapsed on the 3-column audit workspace for breathing room.
    if (isAuditWorkspace) setCollapsed(true);
  }, [isAuditWorkspace]);

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div className={`${collapsed ? 'ml-[68px]' : 'ml-[240px]'} flex flex-col min-h-screen transition-[margin] duration-300`}>
        {isDemo && <DemoBanner />}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
