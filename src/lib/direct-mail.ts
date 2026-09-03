// The direct mail (PostPilot) plan as stored on a Klaviyo audit's
// `direct_mail` section, under `section_details.direct_mail`.
//
// Written by the klaviyo_direct_mail edge function
// (supabase/functions/_shared/direct-mail.ts owns the shape and the maths).
// The report only reads it, so this file is the read-side mirror plus a
// tolerant parser: an older or partial row must render as "nothing here", not
// crash the report. There is deliberately no pricing anywhere in this shape:
// PostPilot's v2 source withdrew its rate card, and the only permitted pricing
// text is the `pricing_note` sentence.

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

export type DirectMailVolume = {
  label: 'Test' | 'Recommended' | 'Scale';
  pieces_per_month: number;
  cadence: string;
};

export type DirectMailProof = { brand: string; model: string; result: string; url: string };

export type DirectMailGate = {
  qualified: boolean;
  reasons: string[];
};

export type DirectMailPlan = {
  version: string;
  expires: string | null;
  computed_at: string;
  gate: DirectMailGate;
  gap: DirectMailGap | null;
  aov: { value: number | null; orders: number | null; window_days: number };
  pairings: DirectMailPairing[];
  cannot_run: DirectMailCannotRun[];
  integration: string[];
  measurement: string[];
  volume: DirectMailVolume[] | null;
  pricing_note: string;
  ecd_fees: { setup: number | null; monthly: number | null };
  compliance: string;
  proof: DirectMailProof[];
  assumptions: string[];
  caveat: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => String(x)) : []);

/** Read the plan off a section's details, or null when there is no plan yet.
 * Rows written by the v1 function (which carried an `investment` table with
 * prices) are treated as absent: they must be regenerated, not rendered. */
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
  if (!String(plan.version ?? '').includes('2.0')) return null;
  return {
    version: String(plan.version ?? ''),
    expires: plan.expires == null ? null : String(plan.expires),
    computed_at: String(plan.computed_at ?? ''),
    gate: { qualified: gate.qualified, reasons: strings(gate.reasons) },
    gap: isObject(plan.gap) ? (plan.gap as unknown as DirectMailGap) : null,
    aov: isObject(plan.aov)
      ? {
          value: typeof plan.aov.value === 'number' ? plan.aov.value : null,
          orders: typeof plan.aov.orders === 'number' ? plan.aov.orders : null,
          window_days: Number(plan.aov.window_days ?? 90),
        }
      : { value: null, orders: null, window_days: 90 },
    pairings: Array.isArray(plan.pairings) ? (plan.pairings as DirectMailPairing[]) : [],
    cannot_run: Array.isArray(plan.cannot_run) ? (plan.cannot_run as DirectMailCannotRun[]) : [],
    integration: strings(plan.integration),
    measurement: strings(plan.measurement),
    volume: Array.isArray(plan.volume) ? (plan.volume as DirectMailVolume[]) : null,
    pricing_note: String(plan.pricing_note ?? ''),
    ecd_fees: isObject(plan.ecd_fees)
      ? {
          setup: typeof plan.ecd_fees.setup === 'number' ? plan.ecd_fees.setup : null,
          monthly: typeof plan.ecd_fees.monthly === 'number' ? plan.ecd_fees.monthly : null,
        }
      : { setup: null, monthly: null },
    compliance: String(plan.compliance ?? ''),
    proof: Array.isArray(plan.proof) ? (plan.proof as DirectMailProof[]) : [],
    assumptions: strings(plan.assumptions),
    caveat: String(plan.caveat ?? ''),
  };
}

export function formatBenchmark(b: DirectMailBenchmark): string {
  return `${b.median}x (${b.p25}x to ${b.p75}x)`;
}
