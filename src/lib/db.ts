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
} from './types';

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

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) throw error;
}

export async function listAudits(): Promise<Audit[]> {
  const { data, error } = await supabase.from('audits').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(a => ({
    ...a,
    show_recommendations: (a as any).show_recommendations ?? true,
  })) as Audit[];
}

export async function listAuditsByClient(clientId: string): Promise<Audit[]> {
  const { data, error } = await supabase
    .from('audits')
    .select('*')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Audit[];
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
  return (data ?? null) as Audit | null;
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

  // Require at least one AI-generated section before allowing publishing.
  const { data: sectionRows, error: secErr } = await supabase
    .from('audit_sections').select('id').eq('audit_id', auditId).limit(1);
  if (secErr) throw secErr;
  if ((sectionRows ?? []).length === 0) {
    throw new Error("Can't publish yet: no audit sections found. Run the AI analysis first.");
  }

  // Generate a token in-app to avoid needing DB extensions.
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const now = new Date().toISOString();
  return updateAudit(auditId, { status: 'published', public_share_token: token, published_at: now });
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
    status: 'draft',
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
} | null> {
  const { data: audit, error: auditErr } = await supabase
    .from('audits')
    .select('*')
    .eq('public_share_token', token)
    .eq('status', 'published')
    .maybeSingle();
  if (auditErr) throw auditErr;
  if (!audit) return null;

  const [client, sections, assets, flows, flowSnaps, segSnaps, formSnaps, campSnaps, scores, recs] = await Promise.all([
    supabase.from('clients').select('*').eq('id', (audit as any).client_id).maybeSingle(),
    supabase.from('audit_sections').select('*').eq('audit_id', (audit as any).id),
    supabase.from('audit_assets').select('*').eq('audit_id', (audit as any).id),
    supabase.from('flow_performance').select('*').eq('audit_id', (audit as any).id),
    supabase.from('klaviyo_flow_snapshots').select('*').eq('audit_id', (audit as any).id),
    supabase.from('klaviyo_segment_snapshots').select('*').eq('audit_id', (audit as any).id),
    supabase.from('klaviyo_form_snapshots').select('*').eq('audit_id', (audit as any).id),
    supabase.from('klaviyo_campaign_snapshots').select('*').eq('audit_id', (audit as any).id),
    supabase.from('health_scores').select('*').eq('audit_id', (audit as any).id),
    supabase.from('recommendations').select('*').eq('audit_id', (audit as any).id).order('sort_order', { ascending: true }),
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
  if (!client.data) return null;

  const allSections = (sections.data ?? []) as AuditSection[];
  const visibleSections = allSections.filter(s => (s as any).status === 'approved');
  const finalSections = visibleSections.length > 0 ? visibleSections : allSections;

  const sectionIds = finalSections.map(s => (s as any).id);
  const annotations = await listAnnotationsForAuditSections(sectionIds);

  return {
    audit: audit as Audit,
    client: client.data as Client,
    sections: finalSections,
    assets: (assets.data ?? []) as AuditAsset[],
    annotations,
    flowPerformance: (flows.data ?? []) as FlowPerformance[],
    flowSnapshots: (flowSnaps.data ?? []) as KlaviyoFlowSnapshot[],
    segmentSnapshots: (segSnaps.data ?? []) as KlaviyoSegmentSnapshot[],
    formSnapshots: (formSnaps.data ?? []) as KlaviyoFormSnapshot[],
    campaignSnapshots: (campSnaps.data ?? []) as KlaviyoCampaignSnapshot[],
    healthScores: (scores.data ?? []) as HealthScoreItem[],
    recommendations: (recs.data ?? []) as Recommendation[],
  };
}

export async function ensureClientCreator(user: Profile | null, client: Partial<Client>): Promise<Partial<Client>> {
  return { ...client, created_by: requireUserId(user) };
}

