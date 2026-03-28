import React from 'react';

const ENTITY_NAME_PATTERNS = [
  // Flow names
  'Abandoned Cart', 'Abandoned Checkout', 'Browse Abandonment', 'Welcome Series',
  'Welcome Flow', 'Post-Purchase', 'Post Purchase', 'Winback', 'Win-Back', 'Re-engagement',
  'Back-in-Stock', 'Back in Stock', 'Price Drop', 'Sunset', 'List Cleaning',
  'Review Request', 'Cross-Sell', 'Upsell', 'Up-Sell', 'Birthday', 'Anniversary',
  'VIP', 'Loyalty', 'Replenishment', 'Thank You', 'Shipping', 'Delivery',
  // Segment names
  'Engaged Subscribers', 'Active Subscribers', 'Inactive Subscribers', 'Unengaged',
  'New Subscribers', 'Repeat Buyers', 'First-Time Buyers', 'High-Value Customers',
  'Lapsed Customers', 'At-Risk', 'Win-Back', 'Churned', 'Newsletter',
  '30-Day Engaged', '60-Day Engaged', '90-Day Engaged', '120-Day Engaged',
  '30-Day Active', '60-Day Active', '90-Day Active', '180-Day Active',
  // Signup form terms
  'Popup', 'Pop-Up', 'Flyout', 'Embedded Form', 'Signup Form', 'Sign-Up Form',
  // Campaign terms
  'A/B Test', 'Campaign', 'Campaigns',
];

function autoBoldEntities(text: string): string {
  if (/\*\*/.test(text)) return text;
  let result = text;
  for (const name of ENTITY_NAME_PATTERNS) {
    const regex = new RegExp(`\\b(${name})\\b`, 'gi');
    result = result.replace(regex, '**$1**');
  }
  return result;
}

function renderInlineBold(text: string) {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>);
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichAuditText({
  text,
  className,
  boldFlowNames = false,
}: {
  text: string;
  className?: string;
  boldFlowNames?: boolean;
}) {
  const processed = boldFlowNames ? autoBoldEntities(text || '') : (text || '');
  const paragraphs = processed
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={`${i}-${p.slice(0, 12)}`} className={i > 0 ? 'mt-2' : ''}>
          {renderInlineBold(p)}
        </p>
      ))}
    </div>
  );
}

