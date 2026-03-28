export interface Profile {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'auditor' | 'viewer';
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  company_name: string;
  website_url: string;
  industry: string;
  esp_platform: string;
  api_key_placeholder: string;
  klaviyo_connected?: boolean;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface Audit {
  id: string;
  client_id: string;
  title: string;
  status: 'draft' | 'in_progress' | 'review' | 'completed' | 'published';
  audit_method: 'api' | 'screenshot';
  list_size: number;
  aov: number;
  monthly_traffic: number;
  total_revenue_opportunity: number;
  executive_summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  public_share_token: string | null;
  show_recommendations: boolean;
  client?: Client;
}

export interface FlowPerformance {
  id: string;
  audit_id: string;
  flow_name: string;
  flow_status: 'live' | 'draft' | 'missing' | 'paused';
  priority: 'critical' | 'high' | 'medium' | 'low' | 'quick_win';
  recipients_per_month: number;
  actual_open_rate: number | null;
  benchmark_open_rate_low: number;
  benchmark_open_rate_high: number;
  actual_click_rate: number | null;
  benchmark_click_rate_low: number;
  benchmark_click_rate_high: number;
  actual_conv_rate: number | null;
  benchmark_conv_rate_low: number;
  benchmark_conv_rate_high: number;
  monthly_revenue_current: number;
  monthly_revenue_opportunity: number;
  notes: string;
}

export interface KlaviyoFlowSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  flow_id: string;
  name: string;
  status: string;
  trigger_type: string | null;
  archived: boolean | null;
  created_at_klaviyo: string | null;
  updated_at_klaviyo: string | null;
  raw: any;
}

export interface KlaviyoCampaignSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  campaign_id: string;
  name: string;
  status: string;
  send_channel: string;
  created_at_klaviyo: string | null;
  updated_at_klaviyo: string | null;
  raw: any;
}

export interface KlaviyoFormSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  form_id: string;
  name: string;
  status: string;
  ab_test: any;
  created_at_klaviyo: string | null;
  updated_at_klaviyo: string | null;
  raw: any;
}

export interface KlaviyoSegmentSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  segment_id: string;
  name: string;
  created_at_klaviyo: string | null;
  updated_at_klaviyo: string | null;
  raw: any;
}

export interface Recommendation {
  id: string;
  audit_id: string;
  tier: 'quick_win' | 'medium' | 'strategic';
  title: string;
  impact: string;
  effort: string;
  description: string;
  sort_order: number;
}

export interface HealthScoreItem {
  category: string;
  score: number;
  max_score: number;
  status: 'good' | 'warning' | 'bad';
  note: string;
}

export interface AuditSection {
  id: string;
  audit_id: string;
  section_key: string;
  current_state_title: string;
  optimized_state_title: string;
  current_state_notes: string;
  optimized_notes: string;
  ai_findings: string;
  human_edited_findings: string;
  summary_text: string;
  revenue_opportunity: number;
  confidence: 'low' | 'medium' | 'high';
  status: 'draft' | 'reviewed' | 'approved';
  section_details?: Record<string, unknown> | null;
}

export interface AuditAsset {
  id: string;
  audit_id: string;
  client_id: string;
  asset_type: string;
  file_url: string;
  file_name: string;
  section_key: string;
  side: 'current' | 'optimized';
  uploaded_at: string;
}

export interface Annotation {
  id: string;
  audit_section_id: string;
  asset_id: string;
  x_position: number;
  y_position: number;
  label: string;
  side: 'current' | 'optimized';
  created_at: string;
}

export interface IndustryExample {
  id: string;
  industry: string;
  email_type: string;
  title: string;
  image_url: string;
  tags: string[];
  notes: string;
}

export interface IndustryEmailLibrary {
  id: string;
  industry: string;
  name: string;
  content_type: 'image' | 'html';
  html_content: string | null;
  image_url: string | null;
  default_annotations: Array<{ x: number; y: number; label: string }>;
  created_at: string;
  updated_at: string;
}

export interface AuditEmailDesign {
  id: string;
  audit_id: string;
  client_email_html: string | null;
  client_campaign_name: string | null;
  client_campaign_id: string | null;
  ecd_example_id: string | null;
  created_at: string;
  ecd_example?: IndustryEmailLibrary | null;
}

export type UserRole = 'admin' | 'auditor' | 'viewer';

export interface WizardData {
  auditId?: string;
  clientId: string;
  clientName: string;
  companyName: string;
  industry?: string;
  espPlatform: string;
  websiteUrl: string;
  listSize: number;
  aov: number;
  monthlyTraffic: number;
  notes: string;
  auditMethod: 'api';
  apiKey?: string;
  screenshots?: Record<string, File[]>;
}
