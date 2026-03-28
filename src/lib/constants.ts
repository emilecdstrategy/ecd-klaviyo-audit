export const SECTION_KEYS = [
  'account_health',
  'flows',
  'segmentation',
  'campaigns',
  'email_design',
  'signup_forms',
  'revenue_summary',
] as const;

export const SECTION_LABELS: Record<string, string> = {
  account_health: 'Account Health Overview',
  flows: 'Flows Audit',
  segmentation: 'Segmentation',
  campaigns: 'Campaigns',
  email_design: 'Email Design',
  signup_forms: 'Signup Forms',
  revenue_summary: 'Revenue Opportunity Summary',
};

export const FLOW_TYPES = [
  'Abandoned Cart',
  'Browse Abandonment',
  'Welcome Series',
  'Post-Purchase',
  'Winback / Re-engagement',
  'Back-in-Stock',
  'Sunset / List Cleaning',
];

export const INDUSTRIES = [
  'Home & Garden',
  'Fashion & Apparel',
  'Beauty & Skincare',
  'Food & Beverage',
  'Health & Wellness',
  'Electronics & Tech',
  'Sports & Outdoors',
  'Jewelry & Accessories',
  'Pet Products',
  'Kids & Baby',
  'Other',
];

export const ESP_PLATFORMS = [
  'Klaviyo',
  'Mailchimp',
  'Omnisend',
  'ActiveCampaign',
  'Other',
];

export const EMAIL_TYPES = [
  'promotional',
  'welcome',
  'post-purchase',
  'seasonal',
  'educational',
];

export const SCREENSHOT_CATEGORIES = [
  { key: 'account_overview', label: 'Account Overview', description: 'Main dashboard or account summary screen' },
  { key: 'flows', label: 'Flow Builder Screenshots', description: 'Screenshots of each active flow and their performance' },
  { key: 'campaigns', label: 'Campaign Calendar / List', description: 'Recent campaign list showing send dates and performance' },
  { key: 'segments', label: 'Segments / Lists', description: 'List of segments with subscriber counts' },
  { key: 'signup_forms', label: 'Signup Forms', description: 'Screenshots of active popup forms and embedded forms' },
  { key: 'email_examples', label: 'Email Examples', description: 'Screenshots of 3-5 recent email designs' },
];

export const CONFIDENCE_LABELS: Record<string, string> = {
  low: 'Low Confidence',
  medium: 'Medium Confidence',
  high: 'High Confidence',
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  in_review: { bg: 'bg-amber-50', text: 'text-amber-700' },
  viewer_only: { bg: 'bg-blue-50', text: 'text-blue-700' },
  published: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};
