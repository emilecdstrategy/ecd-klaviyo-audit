import { useEffect, useState } from 'react';
import { getPublicReportByToken } from '../lib/db';
import type {
  Audit,
  AuditAsset,
  AuditEmailDesign,
  AuditSection,
  Annotation,
  Client,
  FlowPerformance,
  KlaviyoCampaignSnapshot,
  KlaviyoFlowSnapshot,
  KlaviyoFormSnapshot,
  KlaviyoSegmentSnapshot,
} from '../lib/types';

export type AuditReportBundle = {
  audit: Audit;
  client: Client;
  sections: AuditSection[];
  assets: AuditAsset[];
  annotations: Annotation[];
  flowPerformance: FlowPerformance[];
  flowSnapshots: KlaviyoFlowSnapshot[];
  segmentSnapshots: KlaviyoSegmentSnapshot[];
  formSnapshots: KlaviyoFormSnapshot[];
  campaignSnapshots: KlaviyoCampaignSnapshot[];
  emailDesign: AuditEmailDesign | null;
  reportingDiagnostic?: string | null;
  accountSnapshot?: {
    total_profiles_count?: number | null;
    email_subscribed_profiles_count: number | null;
    sms_subscribed_profiles_count?: number | null;
    active_profiles_90d_count: number | null;
    suppressed_profiles_count: number | null;
    bounce_rate_90d: number | null;
    spam_rate_90d: number | null;
    campaign_revenue_per_recipient_30d?: number | null;
    active_profiles_definition?: string | null;
    computed_at?: string | null;
    email_subscribed_profiles_truncated?: boolean | null;
    active_profiles_90d_truncated?: boolean | null;
    suppressed_profiles_truncated?: boolean | null;
    campaigns_truncated?: boolean | null;
    deliverability_campaign_timeframe?: 'last_30_days' | 'last_90_days' | null;
    profile_scan_status?: 'pending' | 'complete' | 'failed' | 'skipped' | null;
  } | null;
};

export function useAuditReportData(token: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [data, setData] = useState<AuditReportBundle | null>(null);

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
