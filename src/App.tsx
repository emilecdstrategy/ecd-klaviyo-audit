import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { getZoneRedirectOrigin } from './lib/route-zones';
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
const PublicProposal = lazy(() => import('./pages/PublicProposal'));
const AdminArea = lazy(() => import('./pages/AdminArea'));
const Proposals = lazy(() => import('./pages/Proposals'));
const NewProposal = lazy(() => import('./pages/NewProposal'));
const ProposalDetail = lazy(() => import('./pages/ProposalDetail'));
const ProposalEditor = lazy(() => import('./pages/ProposalEditor'));
const TemplateEditor = lazy(() => import('./pages/TemplateEditor'));

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
  const isPublicReportRoute =
    location.pathname.startsWith('/report/') || location.pathname.startsWith('/proposal/');
  // Set when an unauthenticated visit got bounced to /login (see the `!user` branch
  // below). If auth resolves while still sitting on /login or another unmatched route
  // (e.g. the session-hydration race where isLoading clears before `user` does), send
  // them back to the page they actually clicked instead of defaulting to "/".
  const deepLinkFrom = typeof state?.from === 'string' ? state.from : null;

  // Proposals live on proposal.ecdigitalstrategy.com; everything else (dashboard,
  // audits, clients, admin) lives on audit.ecdigitalstrategy.com. Checked against
  // whatever's actually being rendered (the modal system swaps in a background
  // location while a "New X" modal is open, so a proposals modal opened from an
  // audit-zone page shouldn't itself trigger a cross-domain redirect). Runs before
  // the auth gate below since the session cookie is shared across both domains
  // anyway, so whichever domain we land on already knows the login state.
  const zonedPathname = (backgroundLocation ?? location).pathname;
  const zoneRedirectOrigin = getZoneRedirectOrigin(zonedPathname);
  if (zoneRedirectOrigin) {
    window.location.replace(`${zoneRedirectOrigin}${location.pathname}${location.search}`);
    return null;
  }

  if (isLoading && !isPublicReportRoute) {
    return <AppPreloader />;
  }

  const isViewer = user && !hasRole('admin');

  const closeAuditWizardModal = () => navigate(-1);

  return (
    <>
    <Suspense fallback={<AppPreloader />}>
      <Routes location={backgroundLocation || location}>
        <Route path="/report/:token" element={<PublicReport />} />
        <Route path="/proposal/:token" element={<PublicProposal />} />

        {!user ? (
          <>
            <Route path="/login" element={<Login />} />
            <Route
              path="*"
              element={
                <Navigate
                  to="/login"
                  replace
                  state={{ from: location.pathname + location.search }}
                />
              }
            />
          </>
        ) : isViewer ? (
          <>
            <Route path="/" element={<ViewerLanding />} />
            <Route path="*" element={<Navigate to={deepLinkFrom || '/'} replace />} />
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
            <Route path="/proposals" element={<Proposals />} />
            <Route path="/proposals/new" element={<NewProposal />} />
            <Route path="/proposals/:id" element={<ProposalDetail />} />
            <Route path="/proposals/:id/edit" element={<ProposalEditor />} />
            <Route path="/proposals/templates/:templateId/edit" element={<TemplateEditor />} />
            <Route path="/admin" element={<AdminArea />} />
            <Route path="*" element={<Navigate to={deepLinkFrom || '/'} replace />} />
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
          <Route
            path="/proposals/new"
            element={
              <Modal open title="New Proposal" onClose={() => navigate(-1)} className="max-w-2xl">
                <NewProposal asModal />
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
