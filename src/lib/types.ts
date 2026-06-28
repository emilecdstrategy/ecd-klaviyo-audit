export interface Profile {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'viewer';
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
  status: 'draft' | 'in_review' | 'viewer_only' | 'published';
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
  /** Meeting notes / client background / instructions for contextual AI refinement */
  context?: AuditContext | null;
  /** Audit-wide layout overrides (nav labels, footer, etc.). JSONB column. */
  layout?: Record<string, unknown> | null;
  client?: Client;
}

export interface RevenueOpportunityTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Rich-text body (markdown). List vs paragraph formatting comes from the editor. */
  content: string;
  /** @deprecated Legacy bullet strings — use `content` instead. */
  bullets: string[];
  /** @deprecated Legacy revenue estimate — use pricing fields instead. */
  default_revenue_monthly: number;
  /** ECD one-time implementation price (headline amount). */
  one_time_price?: number | null;
  /** Optional qualifier for one-time price (ranges, tiers, etc.). */
  one_time_label?: string | null;
  /** ECD monthly retainer price (headline amount). */
  monthly_price?: number | null;
  /** Optional qualifier for monthly price (e.g. "$12,000+/mo"). */
  monthly_label?: string | null;
  /** Optional default screenshot shown on the report add-on card. */
  image_url?: string | null;
  /** Optional link to full service docs or slides (opens in a new tab). */
  details_url?: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RevenueOpportunityAddOnItem {
  template_slug: string;
  name: string;
  description?: string;
  /** Rich-text body (markdown). List vs paragraph formatting comes from the editor. */
  content?: string;
  /** @deprecated Legacy bullet strings — use `content` instead. */
  bullets: string[];
  /** @deprecated Legacy revenue estimate — use pricing fields instead. */
  revenue_monthly: number;
  /** ECD one-time implementation price (headline amount). */
  one_time_price?: number | null;
  /** Optional qualifier for one-time price (ranges, tiers, etc.). */
  one_time_label?: string | null;
  /** ECD monthly retainer price (headline amount). */
  monthly_price?: number | null;
  /** Optional qualifier for monthly price (e.g. "$12,000+/mo"). */
  monthly_label?: string | null;
  /** Per-audit screenshot. Falls back to the template default when added. */
  image_url?: string | null;
  /** Per-audit link to full service docs or slides. */
  details_url?: string | null;
  is_hidden?: boolean;
  display_order?: number;
  /** Admin-selected emphasis for this audit (wizard or post-run). */
  highlighted?: boolean;
  /** AI-assigned report sections where a presenter should demo this add-on. */
  related_section_keys?: string[];
  /** Short AI note for the presenter at those sections. */
  presenter_note?: string;
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
  /** Soft-hide this row in the public report without deleting the data. */
  is_hidden?: boolean;
  /** Override the displayed flow name (Klaviyo name stays in `flow_name`). */
  display_name?: string | null;
  /** Override the computed assessment text in the performance table. */
  display_assessment?: string | null;
  /** Override the computed rating dot color. */
  display_rating?: 'good' | 'warning' | 'bad' | 'missing' | null;
  /** Optional manual ordering in the performance table. */
  display_order?: number | null;
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
  action_count?: number | null;
  flow_actions?: unknown[] | null;
  raw?: unknown;
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
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
  raw?: unknown;
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
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
  raw?: unknown;
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
}

export interface KlaviyoSegmentSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  segment_id: string;
  name: string;
  created_at_klaviyo: string | null;
  updated_at_klaviyo: string | null;
  raw?: unknown;
  is_hidden?: boolean;
  display_name?: string | null;
  display_notes?: string | null;
  display_order?: number | null;
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

export interface SectionKeyFindings {
  items: string[];
  items_hidden?: boolean[];
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
  key_findings?: SectionKeyFindings | null;
  revenue_opportunity: number;
  confidence: 'low' | 'medium' | 'high';
  status: 'draft' | 'approved';
  section_details?: Record<string, unknown> | null;
  /** Per-section override tree, see `src/lib/report-config/types.ts`. JSONB column. */
  section_config?: Record<string, unknown> | null;
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
  asset_id: string | null;
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

export type AnnotationSize = 'sm' | 'md' | 'lg';

export interface IndustryEmailLibrary {
  id: string;
  industry: string;
  name: string;
  content_type: 'image' | 'html';
  html_content: string | null;
  image_url: string | null;
  default_annotations: Array<{ x: number; y: number; label: string }>;
  annotation_size: AnnotationSize;
  annotations_expanded: boolean;
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

export type UserRole = 'admin' | 'viewer';

/** Optional inputs for Phase 2 AI refinement (stored on audit row). */
export interface AuditContext {
  meeting_notes?: string;
  client_background?: string;
  custom_instructions?: string;
  /** If true, the flows audit should treat Subscription lifecycle as a core flow. */
  sells_subscriptions?: boolean;
}

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
  /** Passed to AI Phase 2 when non-empty */
  auditContext?: AuditContext;
  /** full = exact audience counts from profile scan; skipped = fast audit without per-profile pagination */
  profileAudienceScan?: 'full' | 'skipped';
  /** Client has a subscription business model and should be audited for subscription lifecycle flows. */
  clientSellsSubscriptions?: boolean;
}
