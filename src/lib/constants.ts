export const SECTION_LABELS: Record<string, string> = {
  account_health: 'Account Health Overview',
  flows: 'Flows Audit',
  segmentation: 'Segmentation',
  campaigns: 'Campaigns',
  email_design: 'Email Design',
  signup_forms: 'Signup Forms',
  revenue_summary: 'Revenue Opportunity Summary',
};

export {
  CORE_FLOW_MATRIX_NAMES,
  CORE_FLOW_MATRIX_NAMES_WITH_SUBSCRIPTION,
} from './core-flows-matrix';

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
  // Proposal statuses
  sent: { bg: 'bg-blue-50', text: 'text-blue-700' },
  viewed: { bg: 'bg-purple-50', text: 'text-purple-700' },
  won: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  lost: { bg: 'bg-red-50', text: 'text-red-700' },
  expired: { bg: 'bg-gray-100', text: 'text-gray-500' },
};
