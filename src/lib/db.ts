import { supabase } from './supabase';
import type {
  Audit,
  AuditSection,
  Client,
  Profile,
  Annotation,
  AuditAsset,
  FlowPerformance,
  Recommendation,
  HealthScoreItem,
  KlaviyoFlowSnapshot,
  KlaviyoSegmentSnapshot,
  KlaviyoFormSnapshot,
  KlaviyoCampaignSnapshot,
  IndustryEmailLibrary,
  AuditEmailDesign,
  RevenueOpportunityTemplate,
  AnnotationSize,
} from './types';
import {
  applyEntityHighlightStyle,
  normalizeEntityHighlightStyle,
  type EntityHighlightStyle,
} from './entity-highlight-styles';
import { computeAuditTotalRevenueOpportunity, REVENUE_OPPORTUNITY_SECTION_KEYS } from './revenue-calculator';

type AuditSectionRevenueRow = {
  audit_id: string;
  section_key: string;
  revenue_opportunity: number;
  section_config?: Record<string, unknown> | null;
};

function attachComputedRevenueOpportunity(audits: Audit[], sections: AuditSectionRevenueRow[]): Audit[] {
  const sectionsByAudit = new Map<string, AuditSectionRevenueRow[]>();
  for (const section of sections) {
    const list = sectionsByAudit.get(section.audit_id) ?? [];
    list.push(section);
    sectionsByAudit.set(section.audit_id, list);
  }

  return audits.map(audit => ({
    ...audit,
    show_recommendations: (audit as Audit & { show_recommendations?: boolean }).show_recommendations ?? true,
    total_revenue_opportunity: computeAuditTotalRevenueOpportunity(
      sectionsByAudit.get(audit.id) ?? [],
      audit.layout,
    ),
  })) as Audit[];
}

async function fetchRevenueSectionsForAudits(auditIds: string[]): Promise<AuditSectionRevenueRow[]> {
  if (auditIds.length === 0) return [];
  const { data, error } = await supabase
    .from('audit_sections')
    .select('audit_id, section_key, revenue_opportunity, section_config')
    .in('audit_id', auditIds)
    .in('section_key', [...REVENUE_OPPORTUNITY_SECTION_KEYS]);
  if (error) throw error;
  return (data ?? []) as AuditSectionRevenueRow[];
}

function requireUserId(user: Profile | null): string {
  if (!user) throw new Error('Not signed in');
  return user.id;
}

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getClient(id: string): Promise<Client | null> {
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function createClient(input: Omit<Client, 'id' | 'created_at'>): Promise<Client> {
  const { data, error } = await supabase.from('clients').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateClient(id: string, updates: Partial<Omit<Client, 'id' | 'created_at'>>): Promise<Client> {
  const { data, error } = await supabase.from('clients').update(updates).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Client;
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

export async function listAudits(): Promise<Audit[]> {
  const { data, error } = await supabase.from('audits').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  const audits = (data ?? []) as Audit[];
  const sections = await fetchRevenueSectionsForAudits(audits.map(a => a.id));
  return attachComputedRevenueOpportunity(audits, sections);
}

export async function listAuditsByClient(clientId: string): Promise<Audit[]> {
  const { data, error } = await supabase
    .from('audits')
    .select('*')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const audits = (data ?? []) as Audit[];
  const sections = await fetchRevenueSectionsForAudits(audits.map(a => a.id));
  return attachComputedRevenueOpportunity(audits, sections);
}

export async function searchClients(query: string, limit = 5): Promise<Client[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .or(`company_name.ilike.%${q}%,name.ilike.%${q}%,industry.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Client[];
}

export async function searchAudits(query: string, limit = 5): Promise<Audit[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('audits')
    .select('*')
    .ilike('title', `%${q}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Audit[];
}

export async function getAudit(id: string): Promise<Audit | null> {
  const { data, error } = await supabase.from('audits').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const sections = await fetchRevenueSectionsForAudits([id]);
  return attachComputedRevenueOpportunity([data as Audit], sections)[0] ?? null;
}

export async function createAudit(input: Omit<Audit, 'id' | 'created_at' | 'updated_at' | 'published_at' | 'public_share_token'>): Promise<Audit> {
  const { data, error } = await supabase.from('audits').insert(input).select('*').single();
  if (error) throw error;
  return data as Audit;
}

export async function updateAudit(id: string, updates: Partial<Audit>): Promise<Audit> {
  const { data, error } = await supabase.from('audits').update(updates).eq('id', id).select('*').single();
  if (error) throw error;
  return data as Audit;
}

export async function publishAudit(auditId: string): Promise<Audit> {
  const audit = await getAudit(auditId);
  if (!audit) throw new Error('Audit not found');

  const { data: sectionRows, error: secErr } = await supabase
    .from('audit_sections').select('id').eq('audit_id', auditId).limit(1);
  if (secErr) throw secErr;
  if ((sectionRows ?? []).length === 0) {
    throw new Error("Can't publish yet: no audit sections found. Run the AI analysis first.");
  }

  const token = audit.public_share_token || crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = new Date().toISOString();
  return updateAudit(auditId, { status: 'published', public_share_token: token, published_at: now });
}

export async function updateAuditStatus(auditId: string, status: Audit['status']): Promise<Audit> {
  if (status === 'published') return publishAudit(auditId);
  if (status === 'viewer_only') {
    const audit = await getAudit(auditId);
    if (!audit) throw new Error('Audit not found');
    const token = audit.public_share_token || crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    return updateAudit(auditId, { status: 'viewer_only', public_share_token: token });
  }
  return updateAudit(auditId, { status });
}

export async function listAuditSections(auditId: string): Promise<AuditSection[]> {
  const { data, error } = await supabase.from('audit_sections').select('*').eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as AuditSection[];
}

export async function updateAuditSection(id: string, updates: Partial<AuditSection>): Promise<AuditSection> {
  const { data, error } = await supabase.from('audit_sections').update(updates).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AuditSection;
}

export async function updateFlowPerformanceRow(
  id: string,
  patch: Partial<Pick<FlowPerformance, 'is_hidden' | 'display_name' | 'display_assessment' | 'display_rating' | 'display_order' | 'notes'>>,
): Promise<FlowPerformance> {
  const { data, error } = await supabase
    .from('flow_performance')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as FlowPerformance;
}

export async function listFlowPerformance(auditId: string): Promise<FlowPerformance[]> {
  const { data, error } = await supabase
    .from('flow_performance')
    .select('*')
    .eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as FlowPerformance[];
}

// -----------------------------------------------------------------------------
// Per-row overrides for segment / form / campaign snapshots
// -----------------------------------------------------------------------------

type SnapshotRowPatch = {
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
};

export async function listSegmentSnapshots(auditId: string): Promise<KlaviyoSegmentSnapshot[]> {
  const { data, error } = await supabase
    .from('klaviyo_segment_snapshots')
    .select('*')
    .eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as KlaviyoSegmentSnapshot[];
}

export async function updateSegmentSnapshotRow(
  id: string,
  patch: SnapshotRowPatch,
): Promise<KlaviyoSegmentSnapshot> {
  const { data, error } = await supabase
    .from('klaviyo_segment_snapshots')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as KlaviyoSegmentSnapshot;
}

export async function listFormSnapshots(auditId: string): Promise<KlaviyoFormSnapshot[]> {
  const { data, error } = await supabase
    .from('klaviyo_form_snapshots')
    .select('*')
    .eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as KlaviyoFormSnapshot[];
}

export async function updateFormSnapshotRow(
  id: string,
  patch: SnapshotRowPatch,
): Promise<KlaviyoFormSnapshot> {
  const { data, error } = await supabase
    .from('klaviyo_form_snapshots')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as KlaviyoFormSnapshot;
}

export async function listCampaignSnapshots(auditId: string): Promise<KlaviyoCampaignSnapshot[]> {
  const { data, error } = await supabase
    .from('klaviyo_campaign_snapshots')
    .select('*')
    .eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as KlaviyoCampaignSnapshot[];
}

export async function updateCampaignSnapshotRow(
  id: string,
  patch: SnapshotRowPatch,
): Promise<KlaviyoCampaignSnapshot> {
  const { data, error } = await supabase
    .from('klaviyo_campaign_snapshots')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as KlaviyoCampaignSnapshot;
}

export async function createAuditSections(
  auditId: string,
  sectionKeys: string[],
): Promise<AuditSection[]> {
  const rows = sectionKeys.map(section_key => ({
    audit_id: auditId,
    section_key,
    current_state_title: '',
    optimized_state_title: '',
    current_state_notes: '',
    optimized_notes: '',
    ai_findings: '',
    human_edited_findings: '',
    summary_text: '',
    revenue_opportunity: 0,
    confidence: 'medium',
    status: 'approved',
    section_details: null,
  }));
  const { data, error } = await supabase.from('audit_sections').insert(rows).select('*');
  if (error) throw error;
  return (data ?? []) as AuditSection[];
}

export async function listAssets(auditId: string): Promise<AuditAsset[]> {
  const { data, error } = await supabase.from('audit_assets').select('*').eq('audit_id', auditId);
  if (error) throw error;
  return (data ?? []) as AuditAsset[];
}

export async function createAuditAsset(input: Omit<AuditAsset, 'id' | 'uploaded_at'>): Promise<AuditAsset> {
  const { data, error } = await supabase.from('audit_assets').insert(input).select('*').single();
  if (error) throw error;
  return data as AuditAsset;
}

export async function uploadAuditAssetFile(params: {
  auditId: string;
  clientId: string;
  sectionKey: string;
  side: 'current' | 'optimized';
  file: File;
}): Promise<{ publicUrl: string; path: string }> {
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${params.clientId}/${params.auditId}/${params.sectionKey}/${params.side}/${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from('audit-assets')
    .upload(path, params.file, { upsert: false, contentType: params.file.type });
  if (error) throw error;

  const { data } = supabase.storage.from('audit-assets').getPublicUrl(path);
  if (!data.publicUrl) throw new Error('Failed to get public URL');
  return { publicUrl: data.publicUrl, path };
}

export async function listAnnotationsForAuditSections(sectionIds: string[]): Promise<Annotation[]> {
  if (sectionIds.length === 0) return [];
  const { data, error } = await supabase.from('annotations').select('*').in('audit_section_id', sectionIds);
  if (error) throw error;
  return (data ?? []) as Annotation[];
}

export async function createAnnotation(input: Omit<Annotation, 'id' | 'created_at'>): Promise<Annotation> {
  const { data, error } = await supabase.from('annotations').insert(input).select('*').single();
  if (error) throw error;
  return data as Annotation;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase.from('annotations').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchAuditReportBundleForAudit(audit: Audit): Promise<{
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
  healthScores: HealthScoreItem[];
  recommendations: Recommendation[];
  emailDesign: AuditEmailDesign | null;
  reportingDiagnostic?: string | null;
  accountSnapshot?: {
    email_subscribed_profiles_count: number | null;
    active_profiles_90d_count: number | null;
    suppressed_profiles_count: number | null;
    bounce_rate_90d: number | null;
    spam_rate_90d: number | null;
    active_profiles_definition?: string | null;
    computed_at?: string | null;
    email_subscribed_profiles_truncated?: boolean | null;
    active_profiles_90d_truncated?: boolean | null;
    suppressed_profiles_truncated?: boolean | null;
    campaigns_truncated?: boolean | null;
    deliverability_campaign_timeframe?: 'last_30_days' | 'last_90_days' | null;
  } | null;
} | null> {
  const [client, sections, assets, flows, flowSnaps, segSnaps, formSnaps, campSnaps, scores, recs, rollups, emailDesignRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', audit.client_id).maybeSingle(),
    supabase.from('audit_sections').select('*').eq('audit_id', audit.id),
    supabase.from('audit_assets').select('*').eq('audit_id', audit.id),
    supabase.from('flow_performance').select('*').eq('audit_id', audit.id),
    supabase.from('klaviyo_flow_snapshots').select('*').eq('audit_id', audit.id),
    supabase.from('klaviyo_segment_snapshots').select('*').eq('audit_id', audit.id),
    supabase.from('klaviyo_form_snapshots').select('*').eq('audit_id', audit.id),
    supabase.from('klaviyo_campaign_snapshots').select('*').eq('audit_id', audit.id),
    supabase.from('health_scores').select('*').eq('audit_id', audit.id),
    supabase.from('recommendations').select('*').eq('audit_id', audit.id).order('sort_order', { ascending: true }),
    supabase.from('klaviyo_reporting_rollups').select('timeframe_key, computed').eq('audit_id', audit.id),
    supabase.from('audit_email_design').select('*, ecd_example:industry_email_library(*)').eq('audit_id', audit.id).maybeSingle(),
  ]);

  if (client.error) throw client.error;
  if (sections.error) throw sections.error;
  if (assets.error) throw assets.error;
  if (flows.error) throw flows.error;
  if (flowSnaps.error) throw flowSnaps.error;
  if (segSnaps.error) throw segSnaps.error;
  if (formSnaps.error) throw formSnaps.error;
  if (campSnaps.error) throw campSnaps.error;
  if (scores.error) throw scores.error;
  if (recs.error) throw recs.error;
  if (rollups.error) throw rollups.error;
  if (!client.data) return null;

  const allSections = (sections.data ?? []) as AuditSection[];
  const sectionIds = allSections.map(s => s.id);
  const annotations = await listAnnotationsForAuditSections(sectionIds);

  const reportingDiagnostic = ((rollups.data ?? []) as any[])
    .find((r: any) => r.timeframe_key === 'last_30_days')?.computed?.reporting_errors?.[0]?.message
    ?? null;

  const accountSnapshot = ((rollups.data ?? []) as any[])
    .find((r: any) => r.timeframe_key === 'last_30_days')?.computed?.account_snapshot
    ?? null;

  return {
    audit,
    client: client.data as Client,
    sections: allSections,
    assets: (assets.data ?? []) as AuditAsset[],
    annotations,
    flowPerformance: (flows.data ?? []) as FlowPerformance[],
    flowSnapshots: (flowSnaps.data ?? []) as KlaviyoFlowSnapshot[],
    segmentSnapshots: (segSnaps.data ?? []) as KlaviyoSegmentSnapshot[],
    formSnapshots: (formSnaps.data ?? []) as KlaviyoFormSnapshot[],
    campaignSnapshots: (campSnaps.data ?? []) as KlaviyoCampaignSnapshot[],
    healthScores: (scores.data ?? []) as HealthScoreItem[],
    recommendations: (recs.data ?? []) as Recommendation[],
    emailDesign: (emailDesignRes.data ?? null) as AuditEmailDesign | null,
    reportingDiagnostic,
    accountSnapshot,
  };
}

export async function getAuditReportBundleById(auditId: string): Promise<Awaited<ReturnType<typeof fetchAuditReportBundleForAudit>>> {
  const { data: audit, error } = await supabase.from('audits').select('*').eq('id', auditId).maybeSingle();
  if (error) throw error;
  if (!audit) return null;
  return fetchAuditReportBundleForAudit(audit as Audit);
}

export async function getPublicReportByToken(token: string): Promise<{
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
  healthScores: HealthScoreItem[];
  recommendations: Recommendation[];
  emailDesign: AuditEmailDesign | null;
  reportingDiagnostic?: string | null;
  accountSnapshot?: {
    email_subscribed_profiles_count: number | null;
    active_profiles_90d_count: number | null;
    suppressed_profiles_count: number | null;
    bounce_rate_90d: number | null;
    spam_rate_90d: number | null;
    active_profiles_definition?: string | null;
    computed_at?: string | null;
    email_subscribed_profiles_truncated?: boolean | null;
    active_profiles_90d_truncated?: boolean | null;
    suppressed_profiles_truncated?: boolean | null;
    campaigns_truncated?: boolean | null;
    deliverability_campaign_timeframe?: 'last_30_days' | 'last_90_days' | null;
  } | null;
} | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const isAuthenticated = !!sessionData.session;
  let userRole: string | null = null;
  if (isAuthenticated && sessionData.session) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', sessionData.session.user.id).maybeSingle();
    userRole = profile?.role ?? null;
  }
  const isAdmin = userRole === 'admin';

  let query = supabase.from('audits').select('*').eq('public_share_token', token);
  if (!isAuthenticated) {
    query = query.eq('status', 'published');
  } else if (!isAdmin) {
    query = query.in('status', ['published', 'viewer_only']);
  }
  const { data: audit, error: auditErr } = await query.maybeSingle();
  if (auditErr) throw auditErr;
  if (!audit) return null;

  const bundle = await fetchAuditReportBundleForAudit(audit as Audit);
  if (!bundle) return null;

  const visibleSections = bundle.sections.filter(s => s.status === 'approved');
  const finalSections = visibleSections.length > 0 ? visibleSections : bundle.sections;
  const sectionIds = finalSections.map(s => s.id);
  const annotations = await listAnnotationsForAuditSections(sectionIds);

  return {
    ...bundle,
    sections: finalSections,
    annotations,
  };
}

// --- Industry Email Library ---

export async function listIndustryEmailLibrary(): Promise<IndustryEmailLibrary[]> {
  const { data, error } = await supabase.from('industry_email_library').select('*').order('industry');
  if (error) throw error;
  return (data ?? []) as IndustryEmailLibrary[];
}

export async function getIndustryEmailByIndustry(industry: string): Promise<IndustryEmailLibrary | null> {
  const { data, error } = await supabase
    .from('industry_email_library')
    .select('*')
    .eq('industry', industry)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as IndustryEmailLibrary | null;
}

export async function createIndustryEmail(input: Omit<IndustryEmailLibrary, 'id' | 'created_at' | 'updated_at'>): Promise<IndustryEmailLibrary> {
  const { data, error } = await supabase.from('industry_email_library').insert(input).select('*').single();
  if (error) throw error;
  return data as IndustryEmailLibrary;
}

export async function updateIndustryEmail(id: string, updates: Partial<IndustryEmailLibrary>): Promise<IndustryEmailLibrary> {
  const { data, error } = await supabase
    .from('industry_email_library')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as IndustryEmailLibrary;
}

export async function deleteIndustryEmail(id: string): Promise<void> {
  const { error } = await supabase.from('industry_email_library').delete().eq('id', id);
  if (error) throw error;
}

// --- Custom Industries ---

export async function listCustomIndustries(): Promise<string[]> {
  const { data, error } = await supabase.from('custom_industries').select('name').order('name');
  if (error) throw error;
  return (data ?? []).map(r => r.name);
}

export async function createCustomIndustry(name: string): Promise<string> {
  const { data, error } = await supabase.from('custom_industries').insert({ name }).select('name').single();
  if (error) throw error;
  return data.name;
}

// --- Audit Email Design ---

export async function getAuditEmailDesign(auditId: string): Promise<AuditEmailDesign | null> {
  const { data, error } = await supabase
    .from('audit_email_design')
    .select('*, ecd_example:industry_email_library(*)')
    .eq('audit_id', auditId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AuditEmailDesign | null;
}

export async function upsertAuditEmailDesign(
  auditId: string,
  updates: Partial<Omit<AuditEmailDesign, 'id' | 'created_at' | 'ecd_example'>>,
): Promise<AuditEmailDesign> {
  const existing = await getAuditEmailDesign(auditId);
  if (existing) {
    const { data, error } = await supabase
      .from('audit_email_design')
      .update(updates)
      .eq('id', existing.id)
      .select('*, ecd_example:industry_email_library(*)')
      .single();
    if (error) throw error;
    return data as AuditEmailDesign;
  }
  const { data, error } = await supabase
    .from('audit_email_design')
    .insert({ audit_id: auditId, ...updates })
    .select('*, ecd_example:industry_email_library(*)')
    .single();
  if (error) throw error;
  return data as AuditEmailDesign;
}

export async function ensureClientCreator(user: Profile | null, client: Partial<Client>): Promise<Partial<Client>> {
  return { ...client, created_by: requireUserId(user) };
}

export type PlatformSettings = {
  annotation_size: AnnotationSize;
  annotations_expanded: boolean;
  entity_highlight_style: EntityHighlightStyle;
};

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .single();

  const defaults: PlatformSettings = {
    annotation_size: 'md',
    annotations_expanded: false,
    entity_highlight_style: 'purple',
  };

  if (error || !data) return defaults;

  return {
    annotation_size: (data.annotation_size || defaults.annotation_size) as AnnotationSize,
    annotations_expanded: data.annotations_expanded ?? defaults.annotations_expanded,
    entity_highlight_style: normalizeEntityHighlightStyle(
      data.entity_highlight_style ?? defaults.entity_highlight_style,
    ),
  };
}

export async function updatePlatformSettings(updates: {
  annotation_size?: string;
  annotations_expanded?: boolean;
  entity_highlight_style?: EntityHighlightStyle;
}): Promise<void> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', 'default');
  if (error) throw error;
  if (updates.entity_highlight_style) {
    applyEntityHighlightStyle(updates.entity_highlight_style);
  }
}

function coerceTemplateBullets(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(v => String(v ?? '').trim())
    .filter(Boolean);
}

function mapRevenueOpportunityTemplateRow(row: any): RevenueOpportunityTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    bullets: coerceTemplateBullets(row.bullets),
    default_revenue_monthly: Number(row.default_revenue_monthly ?? 0),
    display_order: Number(row.display_order ?? 0),
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listRevenueOpportunityTemplates(
  options: { activeOnly?: boolean } = {},
): Promise<RevenueOpportunityTemplate[]> {
  let query = supabase
    .from('revenue_opportunity_templates')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });
  if (options.activeOnly) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapRevenueOpportunityTemplateRow);
}

export async function createRevenueOpportunityTemplate(
  input: Omit<RevenueOpportunityTemplate, 'id' | 'created_at' | 'updated_at'>,
): Promise<RevenueOpportunityTemplate> {
  const { data, error } = await supabase
    .from('revenue_opportunity_templates')
    .insert({
      ...input,
      bullets: input.bullets ?? [],
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRevenueOpportunityTemplateRow(data);
}

export async function updateRevenueOpportunityTemplate(
  id: string,
  updates: Partial<Omit<RevenueOpportunityTemplate, 'id' | 'created_at' | 'updated_at'>>,
): Promise<RevenueOpportunityTemplate> {
  const { data, error } = await supabase
    .from('revenue_opportunity_templates')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return mapRevenueOpportunityTemplateRow(data);
}

export async function deleteRevenueOpportunityTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('revenue_opportunity_templates')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

