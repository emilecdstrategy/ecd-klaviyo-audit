import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDirectMailPlan,
  buildPairings,
  buildBudget,
  type DirectMailInputs,
  factsForNarrative,
  inferMarketFromKlaviyoAccount,
  sizeGap,
} from "./direct-mail.ts";

// HigherDOSE's real counts on 2026-08-20: 922,846 profiles, 500,350 suppressed,
// 409,091 email subscribed, 231,820 active in 90 days.
const higherDose: DirectMailInputs = {
  total_profiles: 922846,
  email_subscribed: 409091,
  active_90d: 231820,
  suppressed: 500350,
  counts_partial: false,
  aov: 180,
  aov_orders: 9800,
  aov_window_days: 90,
  market: { country: "US", source: "klaviyo_account" },
  monthly_sessions: null,
  store_revenue_30d: 1909771,
  core_flows: [
    { flow_name: "Abandoned Cart", present: true, live: true },
    { flow_name: "Abandoned Checkout", present: true, live: true },
    { flow_name: "Browse Abandonment", present: true, live: true },
    { flow_name: "Welcome Series", present: true, live: true },
    { flow_name: "Post-Purchase", present: true, live: true },
    { flow_name: "Winback / Re-engagement", present: true, live: false },
    { flow_name: "Sunset / List Cleaning", present: true, live: false },
  ],
  has_vip_segments: true,
  sells_subscriptions: false,
  fees: { setup: 2500, monthly: 1500 },
};

Deno.test("audience is sized off the matched count, never the raw one", () => {
  const gap = sizeGap(higherDose)!;
  assertEquals(gap.unengaged, 409091 - 231820);
  assertEquals(gap.unreachable, 500350 + 177271);
  assertEquals(gap.mailable.low, Math.round(677621 * 0.6));
  assertEquals(gap.mailable.high, Math.round(677621 * 0.7));
  assertEquals(gap.sitematch, null);
});

Deno.test("a large US brand with a healthy AOV qualifies", () => {
  const plan = buildDirectMailPlan(higherDose);
  assert(plan.gate.qualified, plan.gate.reasons.join("; "));
  assertEquals(plan.gate.reasons, []);
  assertEquals(plan.gate.checks, { market_us: true, audience_ok: true, aov_ok: true, budget_ok: true });
});

Deno.test("no PostPilot price or rate can appear anywhere in the plan", () => {
  const plan = buildDirectMailPlan(higherDose);
  const text = JSON.stringify(plan) + factsForNarrative(plan, "HigherDOSE");
  const scrubbed = text.replace(plan.pricing_note, "").split(plan.budget_note).join("");
  assert(!/\bPro\+?\b|Growth plan|subscription|rate card/i.test(scrubbed), "a plan or rate leaked");
  assertStringIncludes(plan.budget_note, "planning heuristic");
  assertStringIncludes(plan.pricing_note, "partner contact");
  assertStringIncludes(factsForNarrative(plan, "HigherDOSE"), "never state, estimate or imply a price");
});

Deno.test("the compliance line and the source expiry travel with the plan", () => {
  const plan = buildDirectMailPlan(higherDose);
  assertStringIncludes(plan.compliance, "not a workaround for email suppression");
  assertEquals(plan.expires, "2026-12-31");
  assertStringIncludes(plan.version, "3.0");
});

Deno.test("a non-US brand never qualifies, and says why", () => {
  const plan = buildDirectMailPlan({ ...higherDose, market: { country: "GB", source: "shopify" } });
  assertEquals(plan.gate.qualified, false);
  assertStringIncludes(plan.gate.reasons[0], "GB");
  assertStringIncludes(plan.gate.reasons[0], "US-data only");
});

Deno.test("an unknown market fails the gate rather than guessing", () => {
  const plan = buildDirectMailPlan({ ...higherDose, market: { country: null, source: "unknown" } });
  assertEquals(plan.gate.qualified, false);
  assertStringIncludes(plan.gate.reasons[0], "unknown");
});

Deno.test("a small list is refused even when everything else is fine", () => {
  const plan = buildDirectMailPlan({
    ...higherDose,
    total_profiles: 6000,
    email_subscribed: 4000,
    active_90d: 3500,
    suppressed: 1500,
  });
  assertEquals(plan.gate.qualified, false);
  assertEquals(plan.gate.checks.market_us, true);
  assertEquals(plan.gate.checks.audience_ok, false);
  assertStringIncludes(plan.gate.reasons[0], "3,000");
});

Deno.test("a low AOV fails on the AOV floor, not on audience", () => {
  const plan = buildDirectMailPlan({ ...higherDose, aov: 30 });
  assertEquals(plan.gate.qualified, false);
  assertEquals(plan.gate.checks.audience_ok, true);
  assertEquals(plan.gate.checks.aov_ok, false);
  assertStringIncludes(plan.gate.reasons[0], "$50 floor");
});

Deno.test("no AOV means no verdict and no qualification", () => {
  const plan = buildDirectMailPlan({ ...higherDose, aov: null, aov_orders: null });
  assertEquals(plan.gate.qualified, false);
  assertEquals(plan.gate.checks.aov_ok, null);
  assertStringIncludes(plan.gate.reasons.join(" "), "Placed Order");
});

Deno.test("pairings only cover flows the brand actually runs", () => {
  const rows = buildPairings(
    [
      { flow_name: "Welcome Series", present: true, live: true },
      { flow_name: "Abandoned Checkout", present: true, live: false },
      { flow_name: "Browse Abandonment", present: false, live: false },
    ],
    false,
  );
  assertEquals(rows.map((r) => r.klaviyo_flow), ["Welcome series", "Abandoned cart / checkout"]);
  assertEquals(rows[1].flow_live, false);
});

Deno.test("VIP appreciation appears only when VIP segments exist", () => {
  assertEquals(buildPairings([], null).length, 0);
  assertEquals(buildPairings([], true).map((r) => r.n), [7]);
});

Deno.test("the unreachable winback is always listed; anonymous retargeting only with traffic", () => {
  const without = buildDirectMailPlan(higherDose);
  assertEquals(without.cannot_run.map((c) => c.program), ["Unreachable winback"]);
  const withTraffic = buildDirectMailPlan({ ...higherDose, monthly_sessions: 400000 });
  assertEquals(withTraffic.cannot_run.length, 2);
  assertEquals(withTraffic.gap!.sitematch, { low: 80000, high: 160000, mid: 120000 });
});

Deno.test("the recommended budget is one number: 0.5% of trailing 30-day revenue, in pieces at the indicative rate", () => {
  // HigherDOSE: $1.91M last 30 days. Drew's answer to "is 50k a month high": yes.
  const cols = buildBudget(1909771, sizeGap(higherDose))!;
  assertEquals(cols.map((c) => c.label), ["Recommended"]);
  assertEquals(cols[0].pct, 0.005);
  assertEquals(cols[0].budget_per_month, 9549);
  // $9,549 at $0.70 to $0.80 a piece
  assertEquals(cols[0].pieces_low, Math.round(9549 / 0.8));
  assertEquals(cols[0].pieces_high, Math.round(9549 / 0.7));
  assert(cols[0].pieces_high < 15000, "nowhere near 50,000 a month");
  assertEquals(cols[0].pooled, false);
  assertStringIncludes(cols[0].read, "One test cell");
});

Deno.test("a small store is told to pool months rather than mail a sub-scale test", () => {
  const cols = buildBudget(400000, sizeGap(higherDose))!;
  // 0.5% of $400k = $2,000, about 2,500 to 2,900 pieces: under the 5,000 floor
  assertEquals(cols[0].pooled, true);
  assertStringIncludes(cols[0].read, "pool");
});

Deno.test("pieces are capped at the reachable audience", () => {
  const small = sizeGap({ ...higherDose, total_profiles: 20000, email_subscribed: 12000, active_90d: 10000, suppressed: 4000 })!;
  const cols = buildBudget(5000000, small)!;
  assertEquals(cols[0].pieces_high, small.mailable.mid);
});

Deno.test("a 0.5% budget under $1k a month fails the gate; unknown revenue does not", () => {
  const tiny = buildDirectMailPlan({ ...higherDose, store_revenue_30d: 150000 });
  assertEquals(tiny.gate.qualified, false);
  assertEquals(tiny.gate.checks.budget_ok, false);
  assertStringIncludes(tiny.gate.reasons[0], "under $1,000");
  const unknown = buildDirectMailPlan({ ...higherDose, store_revenue_30d: null });
  assertEquals(unknown.gate.qualified, true);
  assertEquals(unknown.gate.checks.budget_ok, null);
  assertEquals(unknown.budget, null);
});

Deno.test("US inference from a Klaviyo account needs USD and a US timezone", () => {
  assertEquals(inferMarketFromKlaviyoAccount("USD", "US/Eastern"), "US");
  assertEquals(inferMarketFromKlaviyoAccount("USD", "America/Los_Angeles"), "US");
  assertEquals(inferMarketFromKlaviyoAccount("CAD", "America/Toronto"), null);
  assertEquals(inferMarketFromKlaviyoAccount("USD", "America/Toronto"), null);
  assertEquals(inferMarketFromKlaviyoAccount("USD", "Europe/London"), null);
  assertEquals(inferMarketFromKlaviyoAccount(null, null), null);
});

Deno.test("the narrative facts carry the spread and the assumptions but no case-study numbers", () => {
  const facts = factsForNarrative(buildDirectMailPlan(higherDose), "HigherDOSE");
  assertStringIncludes(facts, "3.3x (1.52x to 6.98x)");
  assert(!facts.includes("lower bounds"), "a complete scan is not described as partial");
  assert(!/23\.17|16\.34|10x ROAS|8\.35/.test(facts), "case study results must not reach the model as facts");
  assert(!facts.includes("—"), "no em dashes");
});
