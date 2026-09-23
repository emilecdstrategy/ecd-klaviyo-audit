// Flows that exist for service, not sales: review requests, surveys, order and
// shipping notices, list hygiene. They are judged on delivery, not revenue.
//
// This lives on its own, with no imports, because it used to sit in
// revenue-calculator.ts, and benchmarks.ts importing it from there closed a
// loop: benchmarks -> revenue-calculator -> report-config/resolve ->
// report-config/defaults -> benchmarks. defaults reads a benchmarks constant
// while the module is being loaded, so whichever file happened to load
// benchmarks first got `undefined` and the app crashed at startup ("Cannot
// read properties of undefined (reading 'openRateLow')"). It only worked by
// import order.

const NON_REVENUE_FLOW_PATTERNS = [
  /review\s*request/i,
  /review\s*follow/i,
  /feedback/i,
  /survey/i,
  /nps/i,
  /sunset/i,
  /list\s*clean/i,
  /order\s*confirm/i,
  /order\s*notif/i,
  /shipping/i,
  /delivery/i,
  /fulfillment/i,
  /transactional/i,
  /password\s*reset/i,
  /account\s*confirm/i,
  /double\s*opt/i,
];

export function isNonRevenueFlow(flowName: string): boolean {
  return NON_REVENUE_FLOW_PATTERNS.some(p => p.test(flowName));
}
