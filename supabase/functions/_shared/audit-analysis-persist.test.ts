import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeAuditTotalRevenueOpportunity } from "./audit-analysis-persist.ts";

// The stored total (this function) must equal the displayed total
// (computeAuditTotalRevenueOpportunity in src/lib/revenue-calculator.ts). These
// cases mirror src/lib/revenue-calculator.test.ts.

Deno.test("a hidden section is not counted, read from where the editor stores the flag", () => {
  // The June HigherDose audit, as it sits in the database.
  const sections = [
    { section_key: "campaigns", revenue_opportunity: 4000, section_config: null },
    { section_key: "email_design", revenue_opportunity: 1800, section_config: { email_design: { hidden: true } } },
    { section_key: "flows", revenue_opportunity: 2600, section_config: null },
    { section_key: "segmentation", revenue_opportunity: 6500, section_config: null },
    { section_key: "signup_forms", revenue_opportunity: 1200, section_config: null },
  ];
  // The report shows $14,300; the stored total used to be $16,100.
  assertEquals(computeAuditTotalRevenueOpportunity(sections, {}), 14300);
});

Deno.test("a section whose own config is visible is counted", () => {
  const sections = [
    { section_key: "flows", revenue_opportunity: 1000, section_config: { flows: { hidden: false } } },
  ];
  assertEquals(computeAuditTotalRevenueOpportunity(sections, {}), 1000);
});

Deno.test("add-ons are priced services, not revenue, and are not counted", () => {
  const sections = [{ section_key: "flows", revenue_opportunity: 1000, section_config: { flows: { hidden: false } } }];
  const layout = {
    revenue_summary: { blocks: { addOns: { items: [{ revenue_monthly: 250, is_hidden: false }] } } },
  };
  assertEquals(computeAuditTotalRevenueOpportunity(sections, layout), 1000);
});

Deno.test("sections outside the revenue set never count", () => {
  const sections = [
    { section_key: "account_health", revenue_opportunity: 2800, section_config: null },
    { section_key: "direct_mail", revenue_opportunity: 999, section_config: null },
    { section_key: "revenue_summary", revenue_opportunity: 5, section_config: null },
    { section_key: "campaigns", revenue_opportunity: 100, section_config: null },
  ];
  assertEquals(computeAuditTotalRevenueOpportunity(sections, {}), 100);
});
