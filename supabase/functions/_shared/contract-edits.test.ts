import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyContractEdits } from "./contract-edits.ts";

const MSA = `1. Scope. ECD will perform the services described in each SOW under this Master Services Agreement.
2. Marketing. Client grants ECD the right to use Client's name and logo(s) in ECD's marketing materials.
8. Non-Solicitation. Neither party shall solicit the other's employees during the term.
9. Governing Law. This Agreement is governed by the laws of the State of New York. This Agreement may be amended only in writing.`;

Deno.test("Zak's three redlines apply as small edits, not a retyped contract", () => {
  const out = applyContractEdits(MSA, [
    { find: "under this Master Services Agreement.", replace: "under this Master Services Agreement unless the SOW explicitly states otherwise." },
    { find: "Client's name and logo(s) in", replace: "Client's name and, logo(s), Service Deliverables, and testimonial (if any) in" },
    {
      find: "during the term.",
      replace:
        "during the term. Stipulated Damages. In the event of any violation of the covenants contained in Section 8, Client shall pay ECD the sum of Twenty-Thousand Dollars ($20,000.00) for each and every violation thereof.",
    },
  ]);
  assert(out.ok);
  assertStringIncludes(out.content, "unless the SOW explicitly states otherwise");
  assertStringIncludes(out.content, "Service Deliverables, and testimonial");
  assertStringIncludes(out.content, "Twenty-Thousand Dollars");
  // Everything not touched is byte-identical.
  assertStringIncludes(out.content, "9. Governing Law. This Agreement is governed by the laws of the State of New York.");
});

Deno.test("a paraphrase that is not in the contract is sent back to the model", () => {
  const out = applyContractEdits(MSA, [{ find: "the client lets ECD use their logo", replace: "x" }]);
  assertEquals(out.ok, false);
  if (!out.ok) assertStringIncludes(out.error, "VERBATIM");
});

Deno.test("an excerpt that appears twice is refused rather than guessed", () => {
  const out = applyContractEdits(MSA, [{ find: "This Agreement", replace: "This MSA" }]);
  assertEquals(out.ok, false);
  if (!out.ok) assertStringIncludes(out.error, "matches 2 places");
});

Deno.test("line breaks and double spaces in the quote still land on the passage", () => {
  const out = applyContractEdits(MSA, [{ find: "the   laws of the\nState of New York", replace: "the laws of Delaware" }]);
  assert(out.ok);
  assertStringIncludes(out.content, "governed by the laws of Delaware.");
});

Deno.test("a tiny find is refused", () => {
  const out = applyContractEdits(MSA, [{ find: "ECD", replace: "ECD LLC" }]);
  assertEquals(out.ok, false);
});
