import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Zap } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import NewClient from './pages/NewClient';
import Audits from './pages/Audits';
import NewAudit from './pages/NewAudit';
import AuditWorkspace from './pages/AuditWorkspace';
import PublicReport from './pages/PublicReport';
import AdminArea from './pages/AdminArea';
import Modal from './components/ui/Modal';
import { ToastProvider } from './components/ui/Toast';

function ViewerLanding() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-14 h-14 rounded-xl gradient-bg flex items-center justify-center mx-auto mb-5">
          <Zap className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome to ECD Audit</h1>
        <p className="text-sm text-gray-500 mb-1">Signed in as <span className="font-medium text-gray-700">{user?.email}</span></p>
        <p className="text-sm text-gray-500 mt-4 leading-relaxed">
          Your custom audit report is ready for you. Please open it using the link that was shared with you by the ECD team.
        </p>
        <div className="mt-6 pt-5 border-t border-gray-100">
          <button
            onClick={signOut}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user, isLoading, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as any;
  const backgroundLocation = state?.backgroundLocation as ReturnType<typeof useLocation> | undefined;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Signing you in…</div>
      </div>
    );
  }

  const isViewer = user && !hasRole('admin');

  return (
    <>
    <Routes location={backgroundLocation || location}>
      <Route path="/report/:token" element={<PublicReport />} />

      {!user ? (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : isViewer ? (
        <>
          <Route path="/" element={<ViewerLanding />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/new" element={<NewClient />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/audits" element={<Audits />} />
          <Route path="/audits/new" element={<NewAudit />} />
          <Route path="/audits/:id" element={<AuditWorkspace />} />
          <Route path="/admin" element={<AdminArea />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>

    {backgroundLocation && user && hasRole('admin') && (
      <Routes>
        <Route
          path="/clients/new"
          element={
            <Modal open title="Add Client" onClose={() => navigate(-1)}>
              <NewClient asModal />
            </Modal>
          }
        />
        <Route
          path="/audits/new"
          element={
            <Modal open title="New Audit" onClose={() => navigate(-1)}>
              <NewAudit asModal />
            </Modal>
          }
        />
      </Routes>
    )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
