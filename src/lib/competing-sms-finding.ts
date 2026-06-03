/**
 * Keep in sync with supabase/functions/_shared/competing-sms-finding.ts
 */
import type { CompetingSmsDetection } from './competing-sms-detect';

const BROWSE_PATTERNS = [/browse\s*abandon/i, /browse\s*abandonment/i];
const CART_PATTERNS = [
  /abandon(?:ed)?\s*cart/i,
  /cart\s*abandon/i,
  /checkout\s*abandon/i,
  /abandon(?:ed)?\s*checkout/i,
];

export type RecoveryFlowRevenue = {
  browse_monthly: number | null;
  cart_monthly: number | null;
};

export function sumFlowRevenueByPatterns(
  rows: Array<{ flow_name?: string; monthly_revenue_current?: number | null }> | null | undefined,
  patterns: RegExp[],
): number | null {
  if (!rows?.length) return null;
  let sum = 0;
  let matched = false;
  for (const row of rows) {
    const name = String(row.flow_name ?? '');
    if (!patterns.some((p) => p.test(name))) continue;
    matched = true;
    sum += Number(row.monthly_revenue_current) || 0;
  }
  return matched ? sum : null;
}

export function extractRecoveryFlowRevenue(
  flowPerf: Array<{ flow_name?: string; monthly_revenue_current?: number | null }> | null | undefined,
): RecoveryFlowRevenue {
  return {
    browse_monthly: sumFlowRevenueByPatterns(flowPerf, BROWSE_PATTERNS),
    cart_monthly: sumFlowRevenueByPatterns(flowPerf, CART_PATTERNS),
  };
}

function formatUsd(amount: number | null): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export function buildCompetingSmsKeyFinding(
  platforms: CompetingSmsDetection[],
  recovery: RecoveryFlowRevenue,
): string {
  const names = platforms.map((p) => p.name);
  const vendorList =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;

  const browse = formatUsd(recovery.browse_monthly);
  const cart = formatUsd(recovery.cart_monthly);
  const recoveryBits: string[] = [];
  if (browse) recoveryBits.push(`Browse Abandonment (~${browse}/mo in Klaviyo email)`);
  if (cart) recoveryBits.push(`Cart Abandonment (~${cart}/mo in Klaviyo email)`);
  const recoveryClause = recoveryBits.length
    ? ` Your email flows already show ${recoveryBits.join(' and ')} — revenue you cannot extend to SMS clicks and sessions because those journeys run outside Klaviyo.`
    : ' High-intent Browse and Cart Abandonment flows in Klaviyo cannot fire off SMS clicks because those sessions never enter Klaviyo tracking.';

  return (
    `**${vendorList} SMS is on your site but Klaviyo SMS is not**, so Klaviyo cannot attribute SMS sends, link clicks, or on-site behavior from those messages.` +
    ` That breaks unified tracking and suppresses SMS Browse/Cart abandonment, post-click personalization, and revenue reporting inside Klaviyo.${recoveryClause}`
  ).slice(0, 500);
}

export function injectCompetingSmsFinding(findings: string[], finding: string): string[] {
  const text = finding.trim();
  if (!text) return [...(findings ?? [])];

  const next = [...(findings ?? [])];
  const dupeIdx = next.findIndex(
    (f) =>
      /\bklaviyo sms\b/i.test(f) &&
      (/\bpostscript\b|\battentive\b|\byotpo\b|\bcompeting\b|\boutside klaviyo\b/i.test(f) ||
        /\bcannot track\b/i.test(f)),
  );
  if (dupeIdx >= 0) {
    next[dupeIdx] = text;
    return next.slice(0, 5);
  }

  while (next.length < 5) next.push('');
  next[4] = text;
  return next.slice(0, 5);
}
