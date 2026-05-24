import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import AppPreloader from '../components/ui/AppPreloader';
import { SkeletonAuditWorkspace } from '../components/ui/Skeleton';
import { useAuditReportData } from '../hooks/useAuditReportData';

const AuditReportView = lazy(() => import('../components/report/AuditReportView'));

export default function PublicReport() {
  const { token } = useParams();
  const { loading, loadError, data } = useAuditReportData(token);

  if (loading) {
    return <AppPreloader message="Loading report…" />;
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Couldn&apos;t load report</h1>
          <p className="text-gray-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Report Not Found</h1>
          <p className="text-gray-500">This report link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<SkeletonAuditWorkspace />}>
      <AuditReportView data={data} />
    </Suspense>
  );
}
