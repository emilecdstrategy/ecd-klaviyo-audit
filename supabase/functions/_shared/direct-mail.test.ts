import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDirectMailPlan,
  buildPairings,
  type DirectMailInputs,
  factsForNarrative,
  inferMarketFromKlaviyoAccount,
  planForVolume,
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
  // 60 to 70% of 677,621
  assertEquals(gap.mailable.low, Math.round(677621 * 0.6));
  assertEquals(gap.mailable.high, Math.round(677621 * 0.7));
  assertEquals(gap.sitematch, null);
});

Deno.test("a large US brand with a healthy AOV qualifies", () => {
  const plan = buildDirectMailPlan(higherDose);
  assert(plan.gate.qualified, plan.gate.reasons.join("; "));
  assertEquals(plan.gate.reasons, []);
  const rec = plan.investment!.find((c) => c.label === "Recommended")!;
  // 440k matched, quarterly cadence, capped at the enterprise line
  assertEquals(rec.pieces_per_month, 50000);
  assert(rec.enterprise_quote);
  assertEquals(rec.plan, "pro_plus");
  // $0.67 piece + $0.05 data over a $180 AOV
  assertEquals(rec.blended_cpp, 0.72);
  assert(rec.break_even_rate! < 0.005);
  // Already at the enterprise line: no Scale column repeating the same numbers,
  // and the narrative facts never quote a rate-card dollar total for it.
  assertEquals(plan.investment!.map((c) => c.label), ["Test", "Recommended"]);
  const facts = factsForNarrative(plan, "HigherDOSE");
  assertStringIncludes(facts, "enterprise pricing");
  assert(!facts.includes("$37,000"), "no rate-card total past the enterprise line");
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

Deno.test("a low AOV fails on break-even, not on audience", () => {
  const plan = buildDirectMailPlan({ ...higherDose, aov: 30 });
  assertEquals(plan.gate.qualified, false);
  assertEquals(plan.gate.checks.audience_ok, true);
  assertEquals(plan.gate.checks.break_even_ok, false);
  assertStringIncludes(plan.gate.reasons[0], "Break-even");
});

Deno.test("no AOV means no verdict on break-even and no qualification", () => {
  const plan = buildDirectMailPlan({ ...higherDose, aov: null, aov_orders: null });
  assertEquals(plan.gate.qualified, false);
  assertEquals(plan.gate.checks.break_even_ok, null);
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
  // Cart and checkout collapse into one pairing, and "not live" is carried through.
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

Deno.test("plan tier follows the published crossovers", () => {
  assertEquals(planForVolume(4999), "growth");
  assertEquals(planForVolume(5000), "pro");
  assertEquals(planForVolume(24999), "pro");
  assertEquals(planForVolume(25000), "pro_plus");
});

Deno.test("a mid-size brand lands on Pro with a realistic bill", () => {
  const plan = buildDirectMailPlan({
    ...higherDose,
    total_profiles: 80000,
    email_subscribed: 40000,
    active_90d: 25000,
    suppressed: 20000,
    aov: 95,
  });
  assert(plan.gate.qualified, plan.gate.reasons.join("; "));
  const rec = plan.investment!.find((c) => c.label === "Recommended")!;
  // (20,000 + 15,000) * 0.65 = 22,750 matched; a third a month = 7,583 pieces
  assertEquals(rec.pieces_per_month, 7583);
  assertEquals(rec.plan, "pro");
  assertEquals(rec.postpilot_subscription, 499);
  assertEquals(rec.postpilot_pieces_cost, Math.round(7583 * 0.74));
  assertEquals(rec.ecd_monthly, 1500);
  const test = plan.investment!.find((c) => c.label === "Test")!;
  assertEquals(test.ecd_setup, 2500);
  assertEquals(test.pieces_per_month, 2275);
});

Deno.test("US inference from a Klaviyo account needs USD and a US timezone", () => {
  assertEquals(inferMarketFromKlaviyoAccount("USD", "US/Eastern"), "US");
  assertEquals(inferMarketFromKlaviyoAccount("USD", "America/Los_Angeles"), "US");
  assertEquals(inferMarketFromKlaviyoAccount("CAD", "America/Toronto"), null);
  assertEquals(inferMarketFromKlaviyoAccount("USD", "America/Toronto"), null);
  assertEquals(inferMarketFromKlaviyoAccount("USD", "Europe/London"), null);
  assertEquals(inferMarketFromKlaviyoAccount(null, null), null);
});

Deno.test("the narrative facts carry the spread, the assumptions and no case-study numbers", () => {
  const facts = factsForNarrative(buildDirectMailPlan(higherDose), "HigherDOSE");
  assertStringIncludes(facts, "3.3x (1.52x to 6.98x)");
  assertStringIncludes(facts, "Assumptions:");
  assert(!facts.includes("lower bounds"), "a complete scan is not described as partial");
  assert(!/23\.17|16\.34|10x ROAS/.test(facts), "case study results must not reach the model as facts");
  assert(!facts.includes("—"), "no em dashes");
});
