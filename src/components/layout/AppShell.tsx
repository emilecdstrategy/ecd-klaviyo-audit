import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import DemoBanner from '../ui/DemoBanner';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useMemo, useState } from 'react';

const AUDIT_WORKSPACE_PATH = /^\/audits\/[^/]+$/;

export default function AppShell() {
  const { isDemo } = useAuth();
  const location = useLocation();
  const isAuditWorkspace = useMemo(() => AUDIT_WORKSPACE_PATH.test(location.pathname), [location.pathname]);
  const [collapsed, setCollapsed] = useState(() => AUDIT_WORKSPACE_PATH.test(location.pathname));

  useEffect(() => {
    // Collapsed only on single-audit workspace (/audits/:id); expanded on Dashboard, Clients, Audits list, etc.
    setCollapsed(isAuditWorkspace);
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
