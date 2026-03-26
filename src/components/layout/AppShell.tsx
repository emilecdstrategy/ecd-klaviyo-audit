import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import DemoBanner from '../ui/DemoBanner';
import { useAuth } from '../../contexts/AuthContext';

export default function AppShell() {
  const { isDemo } = useAuth();

  return (
    <div className="min-h-screen bg-[#f8f8f8]">
      <Sidebar />
      <div className="ml-[240px] flex flex-col min-h-screen">
        {isDemo && <DemoBanner />}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
