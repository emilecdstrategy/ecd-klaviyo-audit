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
  email: string;
  website_url: string;
  industry: string;
  esp_platform: string;
  api_key_placeholder: string;
  klaviyo_connected?: boolean;
  shopify_connected?: boolean;
  notes: string;
  /** Set when the client was imported from (or linked to) a HubSpot company. */
  hubspot_company_id?: string | null;
  created_by: string;
  created_at: string;
}

export type AuditType = 'klaviyo' | 'web';

export interface Audit {
  id: string;
  client_id: string;
  title: string;
  status: 'draft' | 'in_review' | 'viewer_only' | 'published';
  /** Which kind of audit this is. `audit_method` describes the data-collection mechanism, not the type. */
  audit_type: AuditType;
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
  /** Display scale for report screenshot (0.2–1, default 1). */
  image_scale?: number | null;
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
  /** When false, excluded from Investment Summary totals (defaults to included). */
  investment_included?: boolean;
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

// ---------------------------------------------------------------------------
// Proposals

/** Stored proposal statuses. 'expired' is derived from valid_until, never stored. */
export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'won' | 'lost';
/** Stored statuses plus the derived 'expired' display status. */
export type ProposalDisplayStatus = ProposalStatus | 'expired';

export interface ProposalBlock {
  key: string;
  title: string;
  /** Markdown rich text. */
  content: string;
}

export type ProposalDiscountType = 'none' | 'fixed' | 'percent';
export type ProposalDiscountAppliesTo = 'one_time' | 'monthly' | 'both';

export interface ProposalCoverOverrides {
  tagline?: string | null;
  background_url?: string | null;
  logo_url?: string | null;
  display_date?: string | null;
}

export interface ProposalContractSnapshot {
  slug: string;
  name: string;
  /** Markdown rich text frozen at send time. */
  content: string;
  version_updated_at: string;
}

export interface Proposal {
  id: string;
  proposal_number: number;
  client_id: string;
  audit_id: string | null;
  template_id: string | null;
  title: string;
  status: ProposalStatus;
  cover: ProposalCoverOverrides;
  content_blocks: ProposalBlock[];
  /** Contract document slugs toggled on for this proposal. */
  include_contracts: string[];
  contracts_snapshot: ProposalContractSnapshot[] | null;
  discount_type: ProposalDiscountType;
  discount_value: number;
  discount_applies_to: ProposalDiscountAppliesTo;
  discount_label: string | null;
  recipient_name: string;
  recipient_email: string;
  recipient2_name: string;
  recipient2_email: string;
  public_token: string | null;
  public_token2: string | null;
  valid_until: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  client_signed_at: string | null;
  countersigned_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Client;
  line_items?: ProposalLineItem[];
}

export interface ProposalLineItem {
  id: string;
  proposal_id: string;
  /** Provenance only — snapshot survives template deletion. */
  template_slug: string | null;
  name: string;
  description: string;
  /** Markdown rich text. */
  content: string;
  one_time_price: number | null;
  one_time_label: string | null;
  monthly_price: number | null;
  monthly_label: string | null;
  image_url: string | null;
  display_order: number;
  created_at: string;
}

/** Line-item shape stored inside proposal_templates.default_line_items JSONB. */
export type ProposalTemplateLineItem = Omit<ProposalLineItem, 'id' | 'proposal_id' | 'created_at'>;

export interface ProposalTemplate {
  id: string;
  name: string;
  content_blocks: ProposalBlock[];
  default_line_items: ProposalTemplateLineItem[];
  /** Contract document slugs included by default. */
  default_contracts: string[];
  /** Default discount carried into proposals created from this template. */
  discount_type: ProposalDiscountType;
  discount_value: number;
  discount_applies_to: ProposalDiscountAppliesTo;
  discount_label: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ContractDocument {
  id: string;
  slug: string;
  name: string;
  /** Markdown rich text. */
  content: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export type ProposalEventType =
  | 'created'
  | 'updated'
  | 'sent'
  | 'resent'
  | 'viewed'
  | 'signed'
  | 'countersigned'
  | 'won'
  | 'lost'
  | 'reopened';

export interface ProposalEvent {
  id: string;
  proposal_id: string;
  event_type: ProposalEventType;
  actor: 'admin' | 'client' | 'system';
  actor_user_id: string | null;
  /** Display name of actor_user_id, resolved client-side; null for client/system actors. */
  actor_name?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Proposal agent chat

export interface ProposalAgentConversation {
  id: string;
  proposal_id: string | null;
  client_id: string | null;
  title: string;
  status: 'active' | 'archived';
  context_summary: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProposalAgentPayloadKind = 'question' | 'draft' | 'edits' | 'doc_fetch' | 'catalog';

export interface ProposalAgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  payload: unknown;
  payload_kind: ProposalAgentPayloadKind | null;
  applied_at: string | null;
  /** Staff member who sent this message (role='user' only). */
  actor_user_id: string | null;
  created_at: string;
}

export type AuditEventType = 'created' | 'edited' | 'published' | 'unpublished' | 'status_changed';

export interface AuditEvent {
  id: string;
  audit_id: string;
  event_type: AuditEventType;
  actor_user_id: string | null;
  /** Display name of actor_user_id, resolved client-side. */
  actor_name?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProposalSignature {
  id: string;
  proposal_id: string;
  role: 'client' | 'agency';
  /** 1 for the primary signer (and agency), 2 for the optional second client signer. */
  signer_index: number;
  signer_name: string;
  signer_email: string;
  signer_user_id: string | null;
  /** PNG data URL. */
  signature_image: string;
  typed_name: string;
  ip_address: string;
  user_agent: string;
  signed_at: string;
}

export interface ProposalSettings {
  cover: {
    background_url: string | null;
    logo_url: string | null;
    tagline: string | null;
  };
  email: {
    from_name: string | null;
    from_email: string | null;
    reply_to: string | null;
    team_notification_emails: string[];
  };
  defaults: {
    valid_days: number;
  };
}

/** Optional inputs for Phase 2 AI refinement (stored on audit row). */
export interface AuditContext {
  meeting_notes?: string;
  client_background?: string;
  custom_instructions?: string;
  /** If true, the flows audit should treat Subscription lifecycle as a core flow. */
  sells_subscriptions?: boolean;
}

interface WizardDataBase {
  auditId?: string;
  clientId: string;
  clientName: string;
  companyName: string;
  industry?: string;
  websiteUrl: string;
  notes: string;
  /** Passed to AI Phase 2 when non-empty */
  auditContext?: AuditContext;
}

export interface KlaviyoWizardData extends WizardDataBase {
  auditType: 'klaviyo';
  espPlatform: string;
  listSize: number;
  aov: number;
  monthlyTraffic: number;
  auditMethod: 'api';
  apiKey?: string;
  screenshots?: Record<string, File[]>;
  /** full = exact audience counts from profile scan; skipped = fast audit without per-profile pagination */
  profileAudienceScan?: 'full' | 'skipped';
  /** Client has a subscription business model and should be audited for subscription lifecycle flows. */
  clientSellsSubscriptions?: boolean;
}

export interface WebWizardData extends WizardDataBase {
  auditType: 'web';
  /** URLs to capture. Homepage defaults to the website URL; others optional. */
  pageUrls: { homepage: string; product?: string; collection?: string; cart?: string };
  shopifyDomain?: string;
  shopifyToken?: string;
}

export type WizardData = KlaviyoWizardData | WebWizardData;

export interface ShopifyConnection {
  client_id: string;
  shop_domain: string;
  shop_id: string | null;
  shop_name: string | null;
  currency: string | null;
  timezone: string | null;
  plan_name: string | null;
  auth_method: 'admin_token' | 'oauth';
  api_version: string;
  scopes: Record<string, unknown>;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WebPageType = 'homepage' | 'product' | 'collection' | 'cart';
export type WebViewport = 'desktop' | 'mobile';

export interface WebPageSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  page_type: WebPageType;
  viewport: WebViewport;
  url: string;
  screenshot_path: string | null;
  screenshot_url: string | null;
  status: 'pending' | 'success' | 'error';
  error_message: string | null;
  metrics: Record<string, unknown>;
  raw: Record<string, unknown>;
  fetched_at: string;
}

export interface ShopifyDataSnapshot {
  id: string;
  audit_id: string;
  client_id: string;
  snapshot_kind: 'shop' | 'orders_rollup' | 'products';
  timeframe_key: string | null;
  computed: Record<string, unknown>;
  raw: Record<string, unknown>;
  fetched_at: string;
}
