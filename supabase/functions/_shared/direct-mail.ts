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
// prose around the numbers, and is told which numbers it may use. Rules from
// PostPilot's own source document are enforced here rather than asked for:
// audiences are sized off the MATCHED count (60 to 70% of emails resolve to an
// address), projections use holdout-tested medians with their spread and never
// case-study results, and no PostPilot price is estimated or shown. The v2
// edition withdrew the rate card to a partner-only annex, so pricing is a
// request to the partner contact, not a number in the report.
//
// Source: "PostPilot x Klaviyo: Direct Mail Companion to a Klaviyo Audit",
// v2.0, 2026-09-02 (supersedes v1.0; expires 2026-12-31, re-confirm after),
// and the 2026 BFCM Direct Mail Benchmark Report medians.

export const DIRECT_MAIL_SECTION_KEY = "direct_mail";
export const DIRECT_MAIL_TEMPLATE_SLUG = "ecd_direct_mail_postpilot";
export const DIRECT_MAIL_SOURCE_VERSION = "postpilot-companion-2.0-2026-09-02";
/** The source document's own expiry. After this, re-confirm with PostPilot. */
export const DIRECT_MAIL_SOURCE_EXPIRES = "2026-12-31";

/** Share of email addresses MailMatch resolves to a mailable home address. */
export const MAILMATCH_RATE = { low: 0.6, high: 0.7 } as const;
/** Share of anonymous site traffic SiteMatch resolves to an address. */
export const SITEMATCH_RATE = { low: 0.2, high: 0.4 } as const;

/** The gate. Below any of these the section does not exist. */
export const GATE = {
  /** Matched retention audience (suppressed + unengaged, times the match midpoint). */
  min_mailable_audience: 3000,
  /** The source's illustrative break-even is $0.74 a piece over AOV at 0.62%. At
   * a 1.5% ceiling that is an AOV of about $49; below $50 a card struggles to
   * pay for itself whatever the rate turns out to be. */
  min_aov: 50,
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

/** The only pricing sentence the source permits. Verbatim. */
export const PRICING_NOTE =
  "PostPilot pricing is supplied by your PostPilot partner contact. Request current rates before quoting.";

/** Required in the audit whenever suppressed or unsubscribed profiles are targeted. */
export const COMPLIANCE_NOTE =
  "This is postal mail to a postal address. An email unsubscribe withdraws email consent; it does not restrict postal mail, and the two channels are governed separately. It is not a workaround for email suppression. DMAchoice mail-preference opt-outs, CCPA/CPRA and equivalent state requests, and brand-level do-not-mail suppression are honored.";

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

export type VolumeColumn = {
  label: "Test" | "Recommended" | "Scale";
  pieces_per_month: number;
  cadence: string;
};

export type ProofCase = { brand: string; model: string; result: string; url: string };

export type GateResult = {
  qualified: boolean;
  reasons: string[];
  checks: {
    market_us: boolean;
    audience_ok: boolean;
    aov_ok: boolean | null;
  };
};

export type DirectMailPlan = {
  version: string;
  expires: string;
  computed_at: string;
  gate: GateResult;
  gap: GapSizing | null;
  aov: { value: number | null; orders: number | null; window_days: number };
  market: { country: string | null; source: MarketSource };
  pairings: Pairing[];
  cannot_run: CannotRun[];
  integration: string[];
  measurement: string[];
  /** Cadence over the matched audience, never a cost. */
  volume: VolumeColumn[] | null;
  pricing_note: string;
  ecd_fees: { setup: number | null; monthly: number | null };
  compliance: string;
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
    companion: "Postcard to known and anonymous browsers",
    timing: "Alongside the email flow",
    audience_source: "MailMatch + SiteMatch",
    benchmark: BENCHMARKS.retargeting,
  },
  {
    n: 2,
    klaviyo_flow: "Welcome series",
    matches: ["Welcome Series"],
    companion: "Postcard to leads who did not convert",
    timing: "Day 7 to 10, after the series",
    audience_source: "MailMatch on the list",
    benchmark: BENCHMARKS.retargeting,
  },
  {
    n: 3,
    klaviyo_flow: "Abandoned cart / checkout",
    matches: ["Abandoned Cart", "Abandoned Checkout"],
    companion: "Postcard with the exact product and a checkout CTA",
    timing: "Day 3 to 5, after the emails",
    audience_source: "MailMatch",
    benchmark: BENCHMARKS.cart,
  },
  {
    n: 4,
    klaviyo_flow: "Post-purchase",
    matches: ["Post-Purchase"],
    companion: "Second-order postcard; handwritten for high AOV",
    timing: "31 to 60 days after purchase",
    audience_source: "Shopify or Klaviyo segment",
    benchmark: BENCHMARKS.retention,
  },
  {
    n: 5,
    klaviyo_flow: "Winback",
    matches: ["Winback / Re-engagement"],
    companion: "Postcard at the expected repurchase lapse",
    timing: "At lapse, about 1.5x the repeat gap",
    audience_source: "Klaviyo segment",
    benchmark: BENCHMARKS.retention,
  },
  {
    n: 7,
    klaviyo_flow: "VIP appreciation",
    matches: ["__vip__"],
    companion: "Handwritten card at milestones",
    timing: "Anniversary, Nth order, birthday",
    audience_source: "Top 10 to 20% by LTV",
    benchmark: BENCHMARKS.retention,
  },
];

/** One row per canonical pairing the brand can actually run: the email flow
 * exists (live or not), or for VIP the segments exist. Pairing 6, the winback
 * Klaviyo cannot run, is always on and lives in buildCannotRun(). */
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
    audience: "Suppressed, unsubscribed and unengaged customers with order history",
    audience_count: gap ? gap.mailable : null,
    why: "No email consent",
    benchmark: BENCHMARKS.retention,
  });
  if (gap?.sitematch) {
    out.push({
      program: "Anonymous visitor retargeting",
      audience: "Site visitors who never gave an email, via SiteMatch",
      audience_count: gap.sitematch,
      why: "Never entered Klaviyo",
      benchmark: BENCHMARKS.retargeting,
    });
  }
  return out;
}

// --- Volume ------------------------------------------------------------------

/** Three sizes of the same program, as pieces a month. A cadence over the
 * matched retention audience, not a forecast and not a cost: a 10% one-off
 * sample to prove incrementality, then the audience on a quarterly cycle, then
 * double that once prospecting comes in. A program already past the point where
 * doubling adds nothing sensible gets two columns, not a third repeating it. */
export function buildVolume(gap: GapSizing): VolumeColumn[] {
  const audience = gap.mailable.mid;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  // Past 50,000 a month the conversation is an enterprise program with
  // PostPilot, not a cadence we should be sizing on their behalf.
  const CAP = 50000;
  const test = clamp(audience * 0.1, 1500, 5000);
  const quarterly = Math.round(audience / 3);
  const recommended = clamp(quarterly, 1500, CAP);
  const scale = clamp(recommended * 2, recommended, CAP);
  const out: VolumeColumn[] = [
    { label: "Test", pieces_per_month: test, cadence: "One-off, 10% sample with holdout" },
    {
      label: "Recommended",
      pieces_per_month: recommended,
      cadence: quarterly > CAP
        ? "Capped; the reachable audience takes more than a quarter to cover"
        : "Reachable audience on a quarterly cycle",
    },
  ];
  if (scale > recommended) out.push({ label: "Scale", pieces_per_month: scale, cadence: "Plus prospecting once retention is proven" });
  return out;
}

// --- Proof -------------------------------------------------------------------

const CASES: Record<string, ProofCase> = {
  awe: {
    brand: "Awe Inspired",
    model: "jewelry, retargeting and retention",
    result: "14.02x iROAS across all holdout campaigns",
    url: "https://postpilot.com/case-studies/awe-inspired",
  },
  axe: {
    brand: "Axe & Sledge",
    model: "supplements, a mail node on every flow",
    result: "Welcome 6.01x, cart 4.66x, winbacks 7.43x+ ROAS",
    url: "https://postpilot.com/case-studies/axe-sledge",
  },
  laird: {
    brand: "Laird Superfood",
    model: "subscription food, anti-churn",
    result: "Unsubscribed 3+ order customers 10x ROAS",
    url: "https://postpilot.com/case-studies/laird-superfood",
  },
  madein: {
    brand: "Made In",
    model: "cookware, high-AOV purchase",
    result: "Abandoned cart at 10% off: 8.35x iROAS",
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

export function evaluateGate(input: DirectMailInputs, gap: GapSizing | null): GateResult {
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
  const aov = num(input.aov);
  const aovOk = aov == null ? null : aov >= GATE.min_aov;
  if (aov == null) reasons.push("Average order value could not be read from the Placed Order metric");
  else if (!aovOk) reasons.push(`AOV of $${Math.round(aov)} is below the $${GATE.min_aov} floor where a postcard can realistically pay for itself`);
  return {
    qualified: marketUs && audienceOk && aovOk === true,
    reasons,
    checks: { market_us: marketUs, audience_ok: audienceOk, aov_ok: aovOk },
  };
}

// --- Assemble ----------------------------------------------------------------

export function buildDirectMailPlan(input: DirectMailInputs, now = new Date()): DirectMailPlan {
  const gap = sizeGap(input);
  const aov = num(input.aov);
  const gate = evaluateGate(input, gap);

  const assumptions: string[] = [];
  assumptions.push(
    `Mailable audience is the suppressed and unengaged count times a ${Math.round(MAILMATCH_RATE.low * 100)} to ${Math.round(MAILMATCH_RATE.high * 100)}% MailMatch rate.`,
  );
  assumptions.push("The suppressed count includes profiles with no orders; PostPilot's segment narrows to 1+ orders, so the real audience is smaller.");
  assumptions.push("Unengaged means email subscribed with no activity in the last 90 days.");
  if (gap?.counts_partial) assumptions.push("The profile scan stopped early, so profile counts are lower bounds.");
  if (aov != null) {
    assumptions.push(`AOV of $${Math.round(aov)} is Placed Order revenue divided by orders over the last ${input.aov_window_days} days.`);
  }
  assumptions.push(
    input.market.source === "shopify"
      ? "Primary market read from the connected Shopify store."
      : input.market.source === "klaviyo_account"
        ? "Primary market inferred from the Klaviyo account's USD currency and US timezone."
        : "Primary market could not be determined.",
  );
  if (!gap?.sitematch) assumptions.push("Site traffic was not sized in this audit, so the never-subscribed audience is not counted.");
  assumptions.push("Volumes are a cadence over the matched audience, not a forecast.");

  return {
    version: DIRECT_MAIL_SOURCE_VERSION,
    expires: DIRECT_MAIL_SOURCE_EXPIRES,
    computed_at: now.toISOString(),
    gate,
    gap,
    aov: { value: aov, orders: num(input.aov_orders), window_days: input.aov_window_days },
    market: input.market,
    pairings: buildPairings(input.core_flows, input.has_vip_segments),
    cannot_run: buildCannotRun(gap),
    integration: [
      "Connect Klaviyo to PostPilot over OAuth and sync the segments; they refresh daily.",
      "A Shopify store connection is required first; a dummy store is fine.",
      "Event Sync (beta, opt-in) can write a Received Mail event back to Klaviyo, with no revenue data.",
    ],
    measurement: [
      "Hold out 10 to 20% of every audience; PostPilot reads the delta as iROAS.",
      "Read each test at 30 days, as a median with its spread.",
      "Two or three one-off tests first, then automate the winners, then scale.",
    ],
    volume: gap ? buildVolume(gap) : null,
    pricing_note: PRICING_NOTE,
    ecd_fees: { setup: num(input.fees.setup), monthly: num(input.fees.monthly) },
    compliance: COMPLIANCE_NOTE,
    proof: pickProof({ sells_subscriptions: input.sells_subscriptions, aov }),
    assumptions,
    caveat: CAVEAT,
  };
}

/** The facts the model is allowed to write from, as plain text. Anything not
 * in here is not in the audit, and the prompt says so. No pricing, ever. */
export function factsForNarrative(plan: DirectMailPlan, companyName: string): string {
  const g = plan.gap;
  const lines: string[] = [];
  lines.push(`Brand: ${companyName}`);
  if (g) {
    lines.push(`Total Klaviyo profiles: ${g.total_profiles.toLocaleString("en-US")}`);
    lines.push(`Suppressed or unsubscribed: ${g.suppressed.toLocaleString("en-US")} (${g.suppressed_pct}%), unreachable by email`);
    lines.push(`Unengaged (subscribed, no activity in 90 days): ${g.unengaged.toLocaleString("en-US")} (${g.unengaged_pct}%)`);
    lines.push(`Matched mailable audience after MailMatch (60 to 70%): ${g.mailable.low.toLocaleString("en-US")} to ${g.mailable.high.toLocaleString("en-US")}`);
    if (g.sitematch && g.monthly_sessions) {
      lines.push(`Monthly site sessions: ${g.monthly_sessions.toLocaleString("en-US")}; SiteMatch could resolve ${g.sitematch.low.toLocaleString("en-US")} to ${g.sitematch.high.toLocaleString("en-US")} anonymous visitors a month`);
    } else {
      lines.push("Site traffic was not sized in this audit");
    }
    if (g.counts_partial) lines.push("Profile counts are lower bounds; the scan stopped early");
  }
  if (plan.aov.value != null) lines.push(`AOV: $${Math.round(plan.aov.value)} over ${plan.aov.window_days} days`);
  lines.push(`Flow pairings available: ${plan.pairings.map((p) => `${p.klaviyo_flow}${p.flow_live ? "" : " (flow not live)"}`).join("; ") || "none"}`);
  lines.push(`Programs Klaviyo cannot run: ${plan.cannot_run.map((c) => c.program).join("; ")}`);
  lines.push(`Benchmarks (holdout-tested medians with 25th to 75th percentile): retention ${BENCHMARKS.retention.median}x (${BENCHMARKS.retention.p25}x to ${BENCHMARKS.retention.p75}x); cart and checkout ${BENCHMARKS.cart.median}x (${BENCHMARKS.cart.p25}x to ${BENCHMARKS.cart.p75}x); retargeting ${BENCHMARKS.retargeting.median}x (${BENCHMARKS.retargeting.p25}x to ${BENCHMARKS.retargeting.p75}x)`);
  lines.push("Recency: median iROAS peaks 31 to 60 days after the last order and stays above 1.8x past two years");
  const rec = plan.volume?.find((c) => c.label === "Recommended");
  if (rec) lines.push(`Recommended cadence: about ${rec.pieces_per_month.toLocaleString("en-US")} postcards a month (${rec.cadence.toLowerCase()})`);
  lines.push("Pricing: none available. PostPilot pricing comes from the partner contact; never state, estimate or imply a price, rate or monthly cost.");
  lines.push(`Compliance (mention in one clause): ${plan.compliance}`);
  return lines.join("\n");
}
