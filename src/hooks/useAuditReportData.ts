import { useEffect, useState } from 'react';
import { getPublicReportByToken, type AuditReportBundle } from '../lib/db';
import { preloadAuditReportView } from '../lib/preload-audit-report-view';
import type { Audit, AuditEmailDesign, AuditSection, Annotation } from '../lib/types';

// One definition, in db.ts, next to the fetch that fills it. The copy that
// lived here had drifted (no revenue_breakdown or deliverability).
export type { AuditReportBundle } from '../lib/db';

export function useAuditReportData(token: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<AuditReportBundle | null>(null);

  useEffect(() => {
    void preloadAuditReportView();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLoading(false);
      setData(null);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setLoadError('');
        const report = await getPublicReportByToken(token);
        if (cancelled) return;
        if (!report) {
          setData(null);
          return;
        }
        setData(report as AuditReportBundle);
      } catch (e: unknown) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return { loading, loadError, data, setData };
}

/** Merge workspace-local audit/sections changes into report bundle for live edit preview. */
export function mergeReportBundle(
  bundle: AuditReportBundle,
  audit: Audit,
  sections: AuditSection[],
  annotations: Annotation[],
  emailDesign?: AuditEmailDesign | null,
): AuditReportBundle {
  const mergedSections = sections.length > 0 ? sections : bundle.sections;
  return {
    ...bundle,
    audit,
    sections: mergedSections,
    annotations,
    ...(emailDesign !== undefined ? { emailDesign } : {}),
  };
}
