import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useEffect, useMemo, useState } from 'react';
import AppPreloader from '../ui/AppPreloader';
import WhatsNewModal from './WhatsNewModal';

const AUDIT_WORKSPACE_PATH = /^\/audits\/[^/]+$/;
// The document workspace (a single doc, its editor, or a template editor) wants
// the extra width; the list and "new" pages do not.
function isDocumentWorkspace(pathname: string): boolean {
  return pathname.startsWith('/documents/') && pathname !== '/documents/new';
}

export default function AppShell() {
  const location = useLocation();
  const wantsCollapse = useMemo(
    () => AUDIT_WORKSPACE_PATH.test(location.pathname) || isDocumentWorkspace(location.pathname),
    [location.pathname],
  );
  const [collapsed, setCollapsed] = useState(() => wantsCollapse);

  useEffect(() => {
    setCollapsed(wantsCollapse);
  }, [wantsCollapse]);

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <WhatsNewModal />
      <Sidebar collapsed={collapsed} onCollapsedChange={setCollapsed} />
      <div className={`app-shell-offset ${collapsed ? 'ml-[68px]' : 'ml-[240px]'} flex flex-col min-h-screen transition-[margin] duration-300`}>
        <main className="flex flex-1 flex-col min-h-[100dvh]">
          <Suspense fallback={<AppPreloader compact />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
