import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Modal from './components/ui/Modal';
import AppPreloader from './components/ui/AppPreloader';
import { ToastProvider } from './components/ui/Toast';
import { PlatformSettingsProvider } from './contexts/PlatformSettingsContext';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Clients = lazy(() => import('./pages/Clients'));
const ClientDetail = lazy(() => import('./pages/ClientDetail'));
const NewClient = lazy(() => import('./pages/NewClient'));
const Audits = lazy(() => import('./pages/Audits'));
const NewAudit = lazy(() => import('./pages/NewAudit'));
const AuditWorkspace = lazy(() => import('./pages/AuditWorkspace'));
const PublicReport = lazy(() => import('./pages/PublicReport'));
const AdminArea = lazy(() => import('./pages/AdminArea'));

function ViewerLanding() {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <img
          src="/cropped-favicon-192x192.webp"
          alt="ECD Digital Strategy"
          className="h-14 w-14 rounded-xl object-cover shadow-md ring-1 ring-black/5 mx-auto mb-5"
          width={56}
          height={56}
        />
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
    return <AppPreloader />;
  }

  const isViewer = user && !hasRole('admin');

  const closeAuditWizardModal = () => navigate(-1);

  return (
    <>
    <Suspense fallback={<AppPreloader />}>
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
    </Suspense>

    {backgroundLocation && user && hasRole('admin') && (
      <Suspense fallback={null}>
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
              <Modal
                open
                title="New Audit"
                onClose={closeAuditWizardModal}
                className="max-w-7xl"
              >
                <NewAudit asModal />
              </Modal>
            }
          />
        </Routes>
      </Suspense>
    )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <PlatformSettingsProvider>
            <AppRoutes />
          </PlatformSettingsProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
