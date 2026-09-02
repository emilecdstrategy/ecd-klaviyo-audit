// The direct mail (PostPilot) plan as stored on a Klaviyo audit's
// `direct_mail` section, under `section_details.direct_mail`.
//
// Written by the klaviyo_direct_mail edge function
// (supabase/functions/_shared/direct-mail.ts owns the shape and the maths).
// The report only reads it, so this file is the read-side mirror plus a
// tolerant parser: an older or partial row must render as "nothing here", not
// crash the report.

export type DirectMailRange = { low: number; high: number; mid: number };

export type DirectMailBenchmark = { label: string; p25: number; median: number; p75: number };

export type DirectMailGap = {
  total_profiles: number;
  suppressed: number;
  suppressed_pct: number;
  unengaged: number;
  unengaged_pct: number;
  unreachable: number;
  mailable: DirectMailRange;
  sitematch: DirectMailRange | null;
  monthly_sessions: number | null;
  counts_partial: boolean;
};

export type DirectMailPairing = {
  n: number;
  klaviyo_flow: string;
  flow_live: boolean;
  companion: string;
  timing: string;
  audience_source: string;
  benchmark: DirectMailBenchmark;
};

export type DirectMailCannotRun = {
  program: string;
  audience: string;
  audience_count: DirectMailRange | null;
  why: string;
  benchmark: DirectMailBenchmark;
};

export type DirectMailInvestmentColumn = {
  label: 'Test' | 'Recommended' | 'Scale';
  pieces_per_month: number;
  plan: 'growth' | 'pro' | 'pro_plus';
  plan_name: string;
  format: string;
  piece_rate: number;
  data_rate: number;
  postpilot_subscription: number;
  postpilot_pieces_cost: number;
  postpilot_monthly_total: number;
  blended_cpp: number;
  break_even_rate: number | null;
  ecd_setup: number | null;
  ecd_monthly: number | null;
  enterprise_quote: boolean;
};

export type DirectMailProof = { brand: string; model: string; result: string; url: string };

export type DirectMailGate = {
  qualified: boolean;
  reasons: string[];
  checks: {
    market_us: boolean;
    audience_ok: boolean;
    break_even_ok: boolean | null;
    spend_ok: boolean;
  };
};

export type DirectMailPlan = {
  version: string;
  computed_at: string;
  gate: DirectMailGate;
  gap: DirectMailGap | null;
  aov: { value: number | null; orders: number | null; window_days: number };
  market: { country: string | null; source: 'shopify' | 'klaviyo_account' | 'unknown' };
  pairings: DirectMailPairing[];
  cannot_run: DirectMailCannotRun[];
  integration: { connection: string; audience_path: string; shopify_prerequisite: string; event_sync: string };
  measurement: { holdout: string; readout: string; phases: string[] };
  investment: DirectMailInvestmentColumn[] | null;
  proof: DirectMailProof[];
  assumptions: string[];
  caveat: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Read the plan off a section's details, or null when there is no plan yet. */
export function parseDirectMailPlan(sectionDetails: unknown): DirectMailPlan | null {
  let details: unknown = sectionDetails;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      return null;
    }
  }
  if (!isObject(details)) return null;
  const plan = details.direct_mail;
  if (!isObject(plan)) return null;
  const gate = plan.gate;
  if (!isObject(gate) || typeof gate.qualified !== 'boolean') return null;
  return {
    version: String(plan.version ?? ''),
    computed_at: String(plan.computed_at ?? ''),
    gate: {
      qualified: gate.qualified,
      reasons: Array.isArray(gate.reasons) ? gate.reasons.map(r => String(r)) : [],
      checks: {
        market_us: Boolean(isObject(gate.checks) && gate.checks.market_us),
        audience_ok: Boolean(isObject(gate.checks) && gate.checks.audience_ok),
        break_even_ok: isObject(gate.checks) && typeof gate.checks.break_even_ok === 'boolean' ? gate.checks.break_even_ok : null,
        spend_ok: Boolean(isObject(gate.checks) && gate.checks.spend_ok),
      },
    },
    gap: isObject(plan.gap) ? (plan.gap as unknown as DirectMailGap) : null,
    aov: isObject(plan.aov)
      ? {
          value: typeof plan.aov.value === 'number' ? plan.aov.value : null,
          orders: typeof plan.aov.orders === 'number' ? plan.aov.orders : null,
          window_days: Number(plan.aov.window_days ?? 90),
        }
      : { value: null, orders: null, window_days: 90 },
    market: isObject(plan.market)
      ? {
          country: plan.market.country == null ? null : String(plan.market.country),
          source: (plan.market.source as DirectMailPlan['market']['source']) ?? 'unknown',
        }
      : { country: null, source: 'unknown' },
    pairings: Array.isArray(plan.pairings) ? (plan.pairings as DirectMailPairing[]) : [],
    cannot_run: Array.isArray(plan.cannot_run) ? (plan.cannot_run as DirectMailCannotRun[]) : [],
    integration: isObject(plan.integration)
      ? (plan.integration as unknown as DirectMailPlan['integration'])
      : { connection: '', audience_path: '', shopify_prerequisite: '', event_sync: '' },
    measurement: isObject(plan.measurement)
      ? {
          holdout: String(plan.measurement.holdout ?? ''),
          readout: String(plan.measurement.readout ?? ''),
          phases: Array.isArray(plan.measurement.phases) ? plan.measurement.phases.map(p => String(p)) : [],
        }
      : { holdout: '', readout: '', phases: [] },
    investment: Array.isArray(plan.investment) ? (plan.investment as DirectMailInvestmentColumn[]) : null,
    proof: Array.isArray(plan.proof) ? (plan.proof as DirectMailProof[]) : [],
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.map(a => String(a)) : [],
    caveat: String(plan.caveat ?? ''),
  };
}

export function formatPct(rate: number, digits = 2): string {
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatBenchmark(b: DirectMailBenchmark): string {
  return `${b.median}x median (${b.p25}x to ${b.p75}x)`;
}
