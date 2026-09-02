// Direct mail companion to a Klaviyo audit, built on PostPilot.
//
// A Klaviyo audit measures what the email program is doing. It says nothing
// about the profiles the program is not allowed to touch: suppressed and
// unsubscribed profiles, and subscribers good deliverability hygiene has
// deliberately stopped mailing. Direct mail is the one owned channel that
// reaches them, so when the numbers support it the report gets an extra
// section and the proposal gets an optional line item.
//
// Everything numeric here is computed in code from the audit's own counts and
// PostPilot's published medians, never by the model. The model only writes the
// prose around the numbers, and is told which numbers it may use. Two rules
// from PostPilot's own source document are enforced here rather than asked
// for: audiences are sized off the MATCHED count (60 to 70% of emails resolve
// to an address), and projections use holdout-tested medians with their
// spread, never case-study results.
//
// Source: "PostPilot x Klaviyo: Direct Mail Companion to a Klaviyo Audit",
// v1.0, 2026-09-01, and the 2026 BFCM Direct Mail Benchmark Report medians.

export const DIRECT_MAIL_SECTION_KEY = "direct_mail";
export const DIRECT_MAIL_TEMPLATE_SLUG = "ecd_direct_mail_postpilot";
export const DIRECT_MAIL_SOURCE_VERSION = "postpilot-companion-1.0-2026-09-01";

/** Share of email addresses MailMatch resolves to a mailable home address. */
export const MAILMATCH_RATE = { low: 0.6, high: 0.7 } as const;
/** Share of anonymous site traffic SiteMatch resolves to an address. */
export const SITEMATCH_RATE = { low: 0.2, high: 0.4 } as const;

/** The gate. Below any of these the section does not exist. */
export const GATE = {
  /** Matched retention audience (suppressed + unengaged, times the match midpoint). */
  min_mailable_audience: 3000,
  /** Share of recipients who must order for a card to pay for itself. */
  max_break_even_rate: 0.015,
  /** Programs under about $1k a month were incremental only 30% of the time. */
  min_monthly_spend: 1000,
} as const;

export type Benchmark = { label: string; p25: number; median: number; p75: number };

/** Holdout-tested medians (campaigns mailed Oct 1 to Nov 20, 2025). */
export const BENCHMARKS = {
  retargeting: { label: "Retargeting (0 orders, engaged) iROAS", p25: 1.09, median: 2.77, p75: 5.64 },
  cart: { label: "Cart and checkout via MailMatch iROAS", p25: 3.06, median: 5.92, p75: 10.42 },
  retention: { label: "Retention (1+ orders) iROAS", p25: 1.52, median: 3.3, p75: 6.98 },
  retention_rpr: { label: "Retention incremental revenue per recipient", p25: 0.93, median: 2.01, p75: 4.11 },
} as const satisfies Record<string, Benchmark>;

/** Median iROAS by days since last order. The 31 to 60 day window is the peak. */
export const RECENCY_CURVE: Array<{ days: string; median: number }> = [
  { days: "15-30", median: 5.66 },
  { days: "31-45", median: 7.65 },
  { days: "46-60", median: 7.09 },
  { days: "61-90", median: 5.19 },
  { days: "91-120", median: 4.99 },
  { days: "121-180", median: 3.3 },
  { days: "181-365", median: 3.3 },
  { days: "366-730", median: 2.75 },
  { days: "730+", median: 1.87 },
];

export type PlanTier = "growth" | "pro" | "pro_plus";

/** Rate card effective 2026-08-31, printing and postage included. */
export const PRICING = {
  plans: {
    growth: { name: "Growth", monthly: 99 },
    pro: { name: "Pro", monthly: 499 },
    pro_plus: { name: "Pro+", monthly: 1000 },
  },
  /** 6x9 outperformed 4x6 by 31% incremental revenue per piece, so it is the default. */
  piece_6x9: { growth: 0.77, pro: 0.69, pro_plus: 0.67 },
  piece_4x6: { growth: 0.68, pro: 0.64, pro_plus: 0.62 },
  handwritten: { growth: 2.99, pro: 1.99, pro_plus: 1.89 },
  /** Per recipient, on top of the piece. */
  data_mailmatch: 0.05,
  data_sitematch: 0.05,
  surcharge_retargeting: 0.05,
  /** Pieces per month where the next plan becomes cheaper overall (6x9). */
  crossover_growth_to_pro: 5000,
  crossover_pro_to_pro_plus: 25000,
  /** Above this PostPilot quotes enterprise pricing; we do not estimate it. */
  enterprise_from: 50000,
} as const;

export const CAVEAT =
  "Benchmarks reflect holdout-tested PostPilot campaigns across thousands of brands and many verticals. " +
  "Individual results vary substantially with audience quality, offer, creative, and AOV; more targeted segments " +
  "typically outperform these medians. Named case-study results are brand-specific and are not a guarantee.";

// --- Inputs ------------------------------------------------------------------

export type MarketSource = "shopify" | "klaviyo_account" | "unknown";

export type CoreFlowState = { flow_name: string; present: boolean; live: boolean };

export type DirectMailInputs = {
  total_profiles: number | null;
  email_subscribed: number | null;
  active_90d: number | null;
  suppressed: number | null;
  /** The profile scan stopped early, so the counts are lower bounds. */
  counts_partial: boolean;
  /** Average order value from the Placed Order metric, and how many orders it rests on. */
  aov: number | null;
  aov_orders: number | null;
  aov_window_days: number;
  market: { country: string | null; source: MarketSource };
  /** Shopify sessions over the last 30 days, when the store is connected. */
  monthly_sessions: number | null;
  core_flows: CoreFlowState[];
  has_vip_segments: boolean | null;
  sells_subscriptions: boolean;
  /** ECD's own fees, from the catalog template. */
  fees: { setup: number | null; monthly: number | null };
};

// --- Output ------------------------------------------------------------------

export type Range = { low: number; high: number; mid: number };

export type GapSizing = {
  total_profiles: number;
  suppressed: number;
  suppressed_pct: number;
  unengaged: number;
  unengaged_pct: number;
  /** Suppressed plus unengaged, before matching. */
  unreachable: number;
  /** After MailMatch. */
  mailable: Range;
  /** Anonymous monthly visitors SiteMatch could resolve, when traffic is known. */
  sitematch: Range | null;
  monthly_sessions: number | null;
  counts_partial: boolean;
};

export type Pairing = {
  n: number;
  klaviyo_flow: string;
  flow_live: boolean;
  companion: string;
  timing: string;
  audience_source: string;
  benchmark: Benchmark;
};

export type CannotRun = {
  program: string;
  audience: string;
  audience_count: Range | null;
  why: string;
  benchmark: Benchmark;
};

export type InvestmentColumn = {
  label: "Test" | "Recommended" | "Scale";
  pieces_per_month: number;
  plan: PlanTier;
  plan_name: string;
  format: string;
  piece_rate: number;
  data_rate: number;
  postpilot_subscription: number;
  postpilot_pieces_cost: number;
  postpilot_monthly_total: number;
  /** Piece plus data, the number the break-even rests on. */
  blended_cpp: number;
  break_even_rate: number | null;
  ecd_setup: number | null;
  ecd_monthly: number | null;
  /** Over the enterprise line: PostPilot quotes it, we do not. */
  enterprise_quote: boolean;
};

export type ProofCase = { brand: string; model: string; result: string; url: string };

export type GateResult = {
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
  gate: GateResult;
  gap: GapSizing | null;
  aov: { value: number | null; orders: number | null; window_days: number };
  market: { country: string | null; source: MarketSource };
  pairings: Pairing[];
  cannot_run: CannotRun[];
  integration: {
    connection: string;
    audience_path: string;
    shopify_prerequisite: string;
    event_sync: string;
  };
  measurement: { holdout: string; readout: string; phases: string[] };
  investment: InvestmentColumn[] | null;
  proof: ProofCase[];
  assumptions: string[];
  caveat: string;
};

// --- Helpers -----------------------------------------------------------------

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function range(base: number, low: number, high: number): Range {
  return {
    low: Math.round(base * low),
    high: Math.round(base * high),
    mid: Math.round(base * ((low + high) / 2)),
  };
}

export function planForVolume(piecesPerMonth: number): PlanTier {
  if (piecesPerMonth < PRICING.crossover_growth_to_pro) return "growth";
  if (piecesPerMonth < PRICING.crossover_pro_to_pro_plus) return "pro";
  return "pro_plus";
}

/** cost per piece divided by AOV: the share of recipients who must order. */
export function breakEvenRate(blendedCpp: number, aov: number | null): number | null {
  if (aov == null || aov <= 0) return null;
  return blendedCpp / aov;
}

function isUs(country: string | null): boolean {
  return (country ?? "").trim().toUpperCase() === "US";
}

/** Two-letter country from a Klaviyo account's currency and timezone, when the
 * store is not connected. USD plus a US timezone is a US brand for our
 * purposes; Canada and Mexico bill in their own currencies. Anything else is
 * unknown, which fails the gate rather than guessing. */
export function inferMarketFromKlaviyoAccount(
  currency: string | null | undefined,
  timezone: string | null | undefined,
): string | null {
  const cur = (currency ?? "").trim().toUpperCase();
  const tz = (timezone ?? "").trim();
  if (cur !== "USD") return null;
  if (/^US\//.test(tz)) return "US";
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|Juneau|Sitka|Nome|Adak|Honolulu)/.test(tz)) return "US";
  if (/^Pacific\/Honolulu$/.test(tz)) return "US";
  return null;
}

// --- Sizing ------------------------------------------------------------------

export function sizeGap(input: DirectMailInputs): GapSizing | null {
  const total = num(input.total_profiles);
  const suppressed = num(input.suppressed);
  const subscribed = num(input.email_subscribed);
  const active = num(input.active_90d);
  if (total == null || suppressed == null || total <= 0) return null;
  const unengaged = subscribed != null && active != null ? Math.max(0, subscribed - active) : 0;
  const unreachable = suppressed + unengaged;
  const sessions = num(input.monthly_sessions);
  return {
    total_profiles: total,
    suppressed,
    suppressed_pct: Math.round((suppressed / total) * 1000) / 10,
    unengaged,
    unengaged_pct: Math.round((unengaged / total) * 1000) / 10,
    unreachable,
    mailable: range(unreachable, MAILMATCH_RATE.low, MAILMATCH_RATE.high),
    sitematch: sessions != null && sessions > 0 ? range(sessions, SITEMATCH_RATE.low, SITEMATCH_RATE.high) : null,
    monthly_sessions: sessions,
    counts_partial: Boolean(input.counts_partial),
  };
}

// --- Pairings ----------------------------------------------------------------

const CANONICAL: Array<Omit<Pairing, "flow_live"> & { matches: string[] }> = [
  {
    n: 1,
    klaviyo_flow: "Browse abandonment",
    matches: ["Browse Abandonment"],
    companion: "Postcard to known browsers, and to anonymous browsers via SiteMatch",
    timing: "Parallel to the email flow",
    audience_source: "MailMatch (known) + SiteMatch (anonymous)",
    benchmark: BENCHMARKS.retargeting,
  },
  {
    n: 2,
    klaviyo_flow: "Welcome series",
    matches: ["Welcome Series"],
    companion: "Postcard to warm leads who did not convert on email",
    timing: "Day 7 to 10, after the series ends",
    audience_source: "MailMatch on the Klaviyo list",
    benchmark: BENCHMARKS.retargeting,
  },
  {
    n: 3,
    klaviyo_flow: "Abandoned cart / checkout",
    matches: ["Abandoned Cart", "Abandoned Checkout"],
    companion: "Postcard featuring the exact product, clear CTA to checkout",
    timing: "Day 3 to 5 after abandon, at the end of the email flow",
    audience_source: "MailMatch",
    benchmark: BENCHMARKS.cart,
  },
  {
    n: 4,
    klaviyo_flow: "Post-purchase / second purchase",
    matches: ["Post-Purchase"],
    companion: "Postcard to compress time to second order; handwritten for high AOV",
    timing: "31 to 60 days after purchase, the peak of the recency curve",
    audience_source: "Shopify or Klaviyo segment",
    benchmark: BENCHMARKS.retention,
  },
  {
    n: 5,
    klaviyo_flow: "Winback at repurchase lapse",
    matches: ["Winback / Re-engagement"],
    companion: "Postcard when the customer passes their expected repurchase window",
    timing: "Triggered at lapse, about 1.5x the median repeat gap",
    audience_source: "Klaviyo segment or PostPilot automation",
    benchmark: BENCHMARKS.retention,
  },
  {
    n: 7,
    klaviyo_flow: "VIP appreciation",
    matches: ["__vip__"],
    companion: "Handwritten card at anniversary, Nth-purchase milestone, birthday",
    timing: "Event-based",
    audience_source: "Top 10 to 20% by LTV or RFM",
    benchmark: BENCHMARKS.retention,
  },
];

/** One row per canonical pairing the brand can actually run: the email flow
 * exists (live or not), or for VIP the segments exist. Pairing 6, the winback
 * Klaviyo cannot run, is always on and lives in cannotRun(). */
export function buildPairings(flows: CoreFlowState[], hasVipSegments: boolean | null): Pairing[] {
  const byName = new Map(flows.map((f) => [f.flow_name, f]));
  const out: Pairing[] = [];
  for (const row of CANONICAL) {
    if (row.matches[0] === "__vip__") {
      if (hasVipSegments !== true) continue;
      const { matches: _m, ...rest } = row;
      out.push({ ...rest, flow_live: true });
      continue;
    }
    const found = row.matches.map((m) => byName.get(m)).filter((f): f is CoreFlowState => Boolean(f && f.present));
    if (found.length === 0) continue;
    const { matches: _m, ...rest } = row;
    out.push({ ...rest, flow_live: found.some((f) => f.live) });
  }
  return out;
}

export function buildCannotRun(gap: GapSizing | null): CannotRun[] {
  const out: CannotRun[] = [];
  out.push({
    program: "Unreachable winback",
    audience: "Suppressed, unsubscribed and unengaged profiles with order history",
    audience_count: gap ? gap.mailable : null,
    why: "No email consent, or excluded by deliverability hygiene",
    benchmark: BENCHMARKS.retention,
  });
  if (gap?.sitematch) {
    out.push({
      program: "Anonymous visitor retargeting",
      audience: "Site visitors who never subscribed, resolved by SiteMatch",
      audience_count: gap.sitematch,
      why: "Never entered Klaviyo",
      benchmark: BENCHMARKS.retargeting,
    });
  }
  return out;
}

// --- Investment --------------------------------------------------------------

function column(
  label: InvestmentColumn["label"],
  pieces: number,
  aov: number | null,
  fees: DirectMailInputs["fees"],
  dataRate: number,
): InvestmentColumn {
  const plan = planForVolume(pieces);
  const pieceRate = PRICING.piece_6x9[plan];
  const blended = pieceRate + dataRate;
  const piecesCost = Math.round(pieces * blended);
  const subscription = PRICING.plans[plan].monthly;
  return {
    label,
    pieces_per_month: pieces,
    plan,
    plan_name: PRICING.plans[plan].name,
    format: "6x9 postcard",
    piece_rate: pieceRate,
    data_rate: dataRate,
    postpilot_subscription: subscription,
    postpilot_pieces_cost: piecesCost,
    postpilot_monthly_total: piecesCost + subscription,
    blended_cpp: Math.round(blended * 100) / 100,
    break_even_rate: breakEvenRate(blended, aov),
    ecd_setup: label === "Test" ? num(fees.setup) : null,
    ecd_monthly: num(fees.monthly),
    enterprise_quote: pieces >= PRICING.enterprise_from,
  };
}

/** Three sizes of the same program. Volumes are a cadence over the matched
 * retention audience, not a forecast: a 10% one-off sample to prove
 * incrementality, then the audience mailed on a quarterly cycle, then double
 * that once prospecting comes in. All three are stated as assumptions. */
export function buildInvestment(gap: GapSizing, aov: number | null, fees: DirectMailInputs["fees"]): InvestmentColumn[] {
  const audience = gap.mailable.mid;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  const test = clamp(audience * 0.1, 1500, 5000);
  const recommended = clamp(audience / 3, 1500, PRICING.enterprise_from);
  const scale = clamp(recommended * 2, recommended, PRICING.enterprise_from);
  const columns = [
    column("Test", test, aov, fees, PRICING.data_mailmatch),
    column("Recommended", recommended, aov, fees, PRICING.data_mailmatch),
  ];
  // A program already at the enterprise line has nowhere to scale to on the
  // rate card; a third column repeating the second would only look like one.
  if (scale > recommended) columns.push(column("Scale", scale, aov, fees, PRICING.data_mailmatch));
  return columns;
}

// --- Proof -------------------------------------------------------------------

const CASES: Record<string, ProofCase> = {
  awe: {
    brand: "Awe Inspired",
    model: "jewelry, automated retargeting and retention",
    result: "14.02x iROAS across all campaigns with holdouts; churned membership winback 4.42x iROAS, running evergreen",
    url: "https://postpilot.com/case-studies/awe-inspired",
  },
  axe: {
    brand: "Axe & Sledge",
    model: "supplements, every Klaviyo flow given a mail node at the end",
    result: "Automated welcome 6.01x ROAS, abandoned cart 4.66x ROAS, evergreen winbacks 7.43x+ ROAS",
    url: "https://postpilot.com/case-studies/axe-sledge",
  },
  laird: {
    brand: "Laird Superfood",
    model: "subscription food, anti-churn and unsubscribed winback",
    result: "Unsubscribed customers with 3+ orders 10x ROAS; anti-churn by cancellation reason 14x ROAS",
    url: "https://postpilot.com/case-studies/laird-superfood",
  },
  madein: {
    brand: "Made In",
    model: "cookware, considered high-AOV purchase",
    result: "Automated abandoned cart at 10% off $100: 8.35x iROAS; winbacks up to 10.29x iROAS",
    url: "https://postpilot.com/case-studies/made-in",
  },
};

export function pickProof(input: { sells_subscriptions: boolean; aov: number | null }): ProofCase[] {
  const out: ProofCase[] = [];
  if (input.sells_subscriptions) out.push(CASES.laird);
  if ((input.aov ?? 0) >= 150) out.push(CASES.madein);
  out.push(CASES.axe);
  if (out.length < 3) out.push(CASES.awe);
  return out.slice(0, 3);
}

// --- Gate --------------------------------------------------------------------

export function evaluateGate(input: DirectMailInputs, gap: GapSizing | null, investment: InvestmentColumn[] | null): GateResult {
  const reasons: string[] = [];
  const marketUs = isUs(input.market.country);
  if (!marketUs) {
    reasons.push(
      input.market.country
        ? `Primary market is ${input.market.country}; MailMatch, SiteMatch and AcquisitionAI are US-data only`
        : "Primary market unknown (no Shopify connection and no US signal on the Klaviyo account)",
    );
  }
  const audienceOk = Boolean(gap && gap.mailable.mid >= GATE.min_mailable_audience);
  if (!gap) reasons.push("Profile counts are not available for this audit");
  else if (!audienceOk) {
    reasons.push(
      `Matched retention audience is about ${gap.mailable.mid.toLocaleString("en-US")}, below the ${GATE.min_mailable_audience.toLocaleString("en-US")} needed for a program that pays for itself`,
    );
  }
  const recommended = investment?.find((c) => c.label === "Recommended") ?? null;
  const be = recommended?.break_even_rate ?? null;
  const breakEvenOk = be == null ? null : be <= GATE.max_break_even_rate;
  if (input.aov == null) reasons.push("Average order value could not be read from the Placed Order metric");
  else if (breakEvenOk === false && recommended) {
    reasons.push(
      `Break-even needs ${(be! * 100).toFixed(2)}% of recipients to order at a $${Math.round(input.aov)} AOV, above the ${(GATE.max_break_even_rate * 100).toFixed(1)}% ceiling`,
    );
  }
  const spendOk = Boolean(recommended && recommended.postpilot_monthly_total >= GATE.min_monthly_spend);
  if (recommended && !spendOk) {
    reasons.push(
      `The recommended program is about $${recommended.postpilot_monthly_total.toLocaleString("en-US")} a month; under $1,000 only about 30% of programs proved incremental`,
    );
  }
  return {
    qualified: marketUs && audienceOk && breakEvenOk === true && spendOk,
    reasons,
    checks: { market_us: marketUs, audience_ok: audienceOk, break_even_ok: breakEvenOk, spend_ok: spendOk },
  };
}

// --- Assemble ----------------------------------------------------------------

export function buildDirectMailPlan(input: DirectMailInputs, now = new Date()): DirectMailPlan {
  const gap = sizeGap(input);
  const aov = num(input.aov);
  const investment = gap ? buildInvestment(gap, aov, input.fees) : null;
  const gate = evaluateGate(input, gap, investment);

  const assumptions: string[] = [];
  assumptions.push(
    `Mailable audience is the suppressed and unengaged count times a ${Math.round(MAILMATCH_RATE.low * 100)} to ${Math.round(MAILMATCH_RATE.high * 100)}% MailMatch rate; tables use the midpoint.`,
  );
  assumptions.push(
    "The suppressed count includes profiles with no order history. PostPilot's segment narrows to 1+ orders, so the real retention audience is smaller than the matched figure.",
  );
  assumptions.push("Unengaged means email subscribed with no activity in the last 90 days, from the profile scan.");
  if (gap?.counts_partial) assumptions.push("The profile scan stopped early, so profile counts are lower bounds.");
  if (aov != null) {
    assumptions.push(
      `AOV of $${Math.round(aov)} is Placed Order revenue divided by orders over the last ${input.aov_window_days} days${input.aov_orders ? ` (${input.aov_orders.toLocaleString("en-US")} orders)` : ""}.`,
    );
  }
  assumptions.push(
    input.market.source === "shopify"
      ? "Primary market read from the connected Shopify store."
      : input.market.source === "klaviyo_account"
        ? "Primary market inferred from the Klaviyo account's USD currency and US timezone; the store is not connected."
        : "Primary market could not be determined.",
  );
  if (!gap?.sitematch) assumptions.push("Site traffic is not available without a Shopify connection, so the never-subscribed audience is not sized.");
  assumptions.push(
    "Volumes are a cadence, not a forecast: a 10% sample to test, the matched audience on a quarterly cycle as the program, and double that at scale. Cost per piece is the 6x9 rate for the plan that volume implies plus $0.05 MailMatch data; PostPilot's subscription is shown separately.",
  );

  return {
    version: DIRECT_MAIL_SOURCE_VERSION,
    computed_at: now.toISOString(),
    gate,
    gap,
    aov: { value: aov, orders: num(input.aov_orders), window_days: input.aov_window_days },
    market: input.market,
    pairings: buildPairings(input.core_flows, input.has_vip_segments),
    cannot_run: buildCannotRun(gap),
    integration: {
      connection: "OAuth to Klaviyo with segments:write, metrics:read and events:write. Legacy API-key connections should be upgraded; they do not get the fast sync engine.",
      audience_path:
        "Segment sync: connect the Klaviyo segments to PostPilot and they refresh daily. Use the in-app Segment Builder when a segment needs an address-resolvability condition.",
      shopify_prerequisite:
        "PostPilot needs an active Shopify store connection before the Klaviyo integration can be configured. A dummy store satisfies it; an External Shop connection does not.",
      event_sync:
        "Event Sync (beta, opt-in per brand) writes a Received PostPilot Mail event to the Klaviyo profile at print time, with no revenue data. Useful for suppressing an email promo the week a card lands; not on by default.",
    },
    measurement: {
      holdout: "Withhold 10 to 20% of every audience as a holdout. PostPilot measures the delta as iROAS and incremental revenue per recipient.",
      readout: "Read each test at 30 days. Report medians with the spread, never a single number, and never place a plain ROAS next to an iROAS.",
      phases: [
        "Phase 1: two or three one-off tests with holdouts (unreachable winback first, then the strongest flow pairing).",
        "Phase 2: automate the winners as always-on programs, mailed at the end of each email sequence.",
        "Phase 3: scale volume and add prospecting (SiteMatch, AcquisitionAI) once retention is proven.",
      ],
    },
    investment,
    proof: pickProof({ sells_subscriptions: input.sells_subscriptions, aov }),
    assumptions,
    caveat: CAVEAT,
  };
}

/** The facts the model is allowed to write from, as plain text. Anything not
 * in here is not in the audit, and the prompt says so. */
export function factsForNarrative(plan: DirectMailPlan, companyName: string): string {
  const g = plan.gap;
  const lines: string[] = [];
  lines.push(`Brand: ${companyName}`);
  if (g) {
    lines.push(`Total Klaviyo profiles: ${g.total_profiles.toLocaleString("en-US")}`);
    lines.push(`Suppressed or unsubscribed: ${g.suppressed.toLocaleString("en-US")} (${g.suppressed_pct}% of profiles), permanently unreachable by email`);
    lines.push(`Unengaged (email subscribed, no activity in 90 days): ${g.unengaged.toLocaleString("en-US")} (${g.unengaged_pct}%)`);
    lines.push(`Matched mailable audience after MailMatch (60 to 70%): ${g.mailable.low.toLocaleString("en-US")} to ${g.mailable.high.toLocaleString("en-US")}`);
    if (g.sitematch && g.monthly_sessions) {
      lines.push(`Monthly site sessions: ${g.monthly_sessions.toLocaleString("en-US")}; SiteMatch could resolve ${g.sitematch.low.toLocaleString("en-US")} to ${g.sitematch.high.toLocaleString("en-US")} anonymous visitors a month`);
    } else {
      lines.push("Site traffic: not available (no Shopify connection), so the never-subscribed audience is not sized");
    }
    if (g.counts_partial) lines.push("Profile counts are lower bounds; the scan stopped early");
  }
  if (plan.aov.value != null) lines.push(`AOV: $${Math.round(plan.aov.value)} over ${plan.aov.window_days} days`);
  lines.push(`Flow pairings available (the brand runs the email flow): ${plan.pairings.map((p) => `${p.klaviyo_flow}${p.flow_live ? "" : " (flow not live)"}`).join("; ") || "none"}`);
  lines.push(`Programs Klaviyo cannot run at all: ${plan.cannot_run.map((c) => c.program).join("; ")}`);
  lines.push(`Benchmarks (holdout-tested medians, with 25th to 75th percentile): retention iROAS ${BENCHMARKS.retention.median}x (${BENCHMARKS.retention.p25}x to ${BENCHMARKS.retention.p75}x); cart and checkout ${BENCHMARKS.cart.median}x (${BENCHMARKS.cart.p25}x to ${BENCHMARKS.cart.p75}x); retargeting ${BENCHMARKS.retargeting.median}x (${BENCHMARKS.retargeting.p25}x to ${BENCHMARKS.retargeting.p75}x)`);
  lines.push("Recency curve: median iROAS peaks at 31 to 60 days since last order (7.65x and 7.09x) and stays above 1.8x past two years");
  const rec = plan.investment?.find((c) => c.label === "Recommended");
  if (rec && rec.enterprise_quote) {
    lines.push(
      `Recommended program: the matched audience is large enough that a quarterly cycle runs past ${PRICING.enterprise_from.toLocaleString("en-US")} pieces a month, where PostPilot quotes enterprise pricing rather than the rate card. Do not state a monthly dollar figure. Blended rate-card cost per piece for reference: $${rec.blended_cpp.toFixed(2)}${rec.break_even_rate != null ? `; break-even ${(rec.break_even_rate * 100).toFixed(2)}% of recipients must order` : ""}`,
    );
  } else if (rec) {
    lines.push(
      `Recommended program: about ${rec.pieces_per_month.toLocaleString("en-US")} 6x9 postcards a month on the ${rec.plan_name} plan, roughly $${rec.postpilot_monthly_total.toLocaleString("en-US")} a month to PostPilot including subscription; blended cost per piece $${rec.blended_cpp.toFixed(2)}${rec.break_even_rate != null ? `; break-even ${(rec.break_even_rate * 100).toFixed(2)}% of recipients must order` : ""}`,
    );
  }
  lines.push(`Integration: ${plan.integration.audience_path} ${plan.integration.shopify_prerequisite}`);
  lines.push(`Event Sync: ${plan.integration.event_sync}`);
  lines.push(`Measurement: ${plan.measurement.holdout} ${plan.measurement.readout}`);
  lines.push(`Assumptions: ${plan.assumptions.join(" ")}`);
  return lines.join("\n");
}
