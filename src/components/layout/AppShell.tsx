import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useEffect, useMemo, useState } from 'react';

const AUDIT_WORKSPACE_PATH = /^\/audits\/[^/]+$/;

export default function AppShell() {
  const location = useLocation();
  const isAuditWorkspace = useMemo(() => AUDIT_WORKSPACE_PATH.test(location.pathname), [location.pathname]);
  const [collapsed, setCollapsed] = useState(() => AUDIT_WORKSPACE_PATH.test(location.pathname));

  useEffect(() => {
    setCollapsed(isAuditWorkspace);
  }, [isAuditWorkspace]);

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div className={`${collapsed ? 'ml-[68px]' : 'ml-[240px]'} flex flex-col min-h-screen transition-[margin] duration-300`}>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
