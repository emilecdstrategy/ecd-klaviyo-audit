let preloadPromise: Promise<typeof import('../components/report/AuditReportView')> | null = null;

/** Start downloading the AuditReportView chunk early (safe to call multiple times). */
export function preloadAuditReportView() {
  if (!preloadPromise) {
    preloadPromise = import('../components/report/AuditReportView');
  }
  return preloadPromise;
}

export function lazyAuditReportView() {
  return preloadAuditReportView();
}
