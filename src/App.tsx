import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
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

function AppRoutes() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as any;
  const backgroundLocation = state?.backgroundLocation as ReturnType<typeof useLocation> | undefined;

  // Important: during a magic-link redirect, Supabase needs a moment to hydrate
  // the session from the URL/storage. If we redirect to /login while loading,
  // we can get stuck in an auth bounce.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-sm text-gray-500">Signing you in…</div>
      </div>
    );
  }

  return (
    <>
    <Routes location={backgroundLocation || location}>
      <Route path="/report/:token" element={<PublicReport />} />

      {!user ? (
        <>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
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

    {backgroundLocation && user && (
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
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
