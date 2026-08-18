import { supabase } from './supabase';
import type { WebRoadmapRow } from './web-report-details';

/** What an hour of implementation costs when a roadmap has no rate of its own. */
export const DEFAULT_HOURLY_RATE = 175;

/** Hours are entered in half-hour steps: half an hour, an hour, two and a half. */
export const HOUR_STEP = 0.5;
export const MAX_HOURS = 200;

export async function getWebAuditHourlyRate(): Promise<number> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('web_audit_settings')
    .eq('id', 'default')
    .maybeSingle();
  if (error || !data) return DEFAULT_HOURLY_RATE;
  return normalizeRate((data.web_audit_settings as { hourly_rate?: unknown } | null)?.hourly_rate);
}

export async function updateWebAuditHourlyRate(rate: number): Promise<void> {
  const { error } = await supabase
    .from('platform_settings')
    .update({ web_audit_settings: { hourly_rate: normalizeRate(rate) }, updated_at: new Date().toISOString() })
    .eq('id', 'default');
  if (error) throw error;
}

export function normalizeRate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_HOURLY_RATE;
}

/** Snap typed hours to the nearest half hour, inside sane bounds. */
export function normalizeHours(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_HOURS, Math.round(n / HOUR_STEP) * HOUR_STEP);
}

/** What a row costs to set up. Null when nobody has estimated it yet. */
export function setupCost(row: WebRoadmapRow, hourlyRate: number): number | null {
  const hours = normalizeHours(row.setup_hours);
  return hours == null ? null : Math.round(hours * hourlyRate);
}

/** Rows that belong in the investment summary and in a proposal built from it:
 *  visible, and not unticked. A row with no hours estimated yet is still listed,
 *  because leaving it out silently would understate the total. */
export function investmentRows(rows: WebRoadmapRow[]): WebRoadmapRow[] {
  return rows.filter((r) => !r.hidden && r.investment_included !== false);
}

/** Free text like "$450/mo" or "$1,200 / month" carries a real number often
 *  enough to be worth totalling. Anything else stays a label, never a guess. */
export function parseMonthly(label: string | null | undefined): number | null {
  const v = (label ?? '').trim();
  if (!v || v === '—' || v === '-') return null;
  if (!/mo|month/i.test(v)) return null;
  const m = v.replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type WebInvestmentTotals = {
  oneTimeTotal: number;
  monthlyTotal: number;
  /** Rows counted in, rows still waiting on an estimate, rows whose ongoing
   *  cost is words rather than a figure. */
  pricedCount: number;
  unpricedCount: number;
  ongoingLabelOnly: boolean;
};

export function computeWebInvestmentTotals(rows: WebRoadmapRow[], hourlyRate: number): WebInvestmentTotals {
  let oneTimeTotal = 0;
  let monthlyTotal = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let ongoingLabelOnly = false;

  for (const row of investmentRows(rows)) {
    const cost = setupCost(row, hourlyRate);
    if (cost == null) unpricedCount += 1;
    else {
      oneTimeTotal += cost;
      pricedCount += 1;
    }
    const monthly = parseMonthly(row.ongoing_cost_label);
    if (monthly != null) monthlyTotal += monthly;
    else if ((row.ongoing_cost_label ?? '').trim() && !/^[—-]$/.test(row.ongoing_cost_label.trim())) ongoingLabelOnly = true;
  }

  return { oneTimeTotal, monthlyTotal, pricedCount, unpricedCount, ongoingLabelOnly };
}

export function formatHours(hours: number | null | undefined): string {
  const h = normalizeHours(hours);
  if (h == null) return '—';
  return `${h % 1 === 0 ? h : h.toFixed(1)} ${h === 1 ? 'hr' : 'hrs'}`;
}
