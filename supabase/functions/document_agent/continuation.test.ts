import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { continuationPrompt, joinParts, MAX_DOC_CHARS } from "./continuation.ts";

const PART_ONE = `## Scope of Work

The contractor will deliver the services described below.

## Payment Terms

Invoices are issued monthly and due within 14 days.`;

Deno.test("joinParts puts exactly one blank line between the parts", () => {
  assertEquals(
    joinParts("First part.\n\n\n", "\n\n  Second part."),
    "First part.\n\nSecond part.",
  );
});

Deno.test("joinParts keeps a genuinely new section", () => {
  const joined = joinParts(PART_ONE, "## Confidentiality\n\nBoth parties keep the terms private.");
  assertStringIncludes(joined, "## Payment Terms");
  assertStringIncludes(joined, "## Confidentiality");
  // Nothing appears twice.
  assertEquals(joined.match(/## Payment Terms/g)?.length, 1);
});

Deno.test("joinParts drops a repeated opening heading rather than showing it twice", () => {
  // The model was told not to restate the heading it stopped under. When it
  // does anyway, the document must not carry the section title twice.
  const joined = joinParts(PART_ONE, "## Payment Terms\n\nLate invoices accrue interest at 2% monthly.");
  assertEquals(joined.match(/## Payment Terms/g)?.length, 1);
  assertStringIncludes(joined, "Late invoices accrue interest");
  assertStringIncludes(joined, "due within 14 days.");
});

Deno.test("joinParts survives a part that is only whitespace", () => {
  assertEquals(joinParts(PART_ONE, "   \n\n "), PART_ONE);
});

Deno.test("continuationPrompt lists the headings already written and names the right tool", () => {
  const draftPrompt = continuationPrompt(PART_ONE, false);
  assertStringIncludes(draftPrompt, "Scope of Work; Payment Terms");
  assertStringIncludes(draftPrompt, "propose_draft");
  assert(!draftPrompt.includes("propose_edits"));

  const editPrompt = continuationPrompt(PART_ONE, true);
  assertStringIncludes(editPrompt, "propose_edits");
});

Deno.test("continuationPrompt sends back only the tail of a long document", () => {
  const long = "x".repeat(50_000) + "\n\nThe final sentence of part one.";
  const prompt = continuationPrompt(long, false);
  assertStringIncludes(prompt, "The final sentence of part one.");
  // Nowhere near the whole body: the tail is capped.
  assert(prompt.length < 6_000, `prompt was ${prompt.length} chars`);
});

Deno.test("continuationPrompt handles a document with no headings", () => {
  const prompt = continuationPrompt("A letter with no headings at all.", false);
  assert(!prompt.includes("Sections already written"));
  assertStringIncludes(prompt, "A letter with no headings at all.");
});

Deno.test("the runaway backstop is far above any real document", () => {
  // A 60 page agreement is about 150k characters, so the guard must sit above
  // that: it exists to stop a model that never lowers the flag, not to cut
  // long documents short.
  assert(MAX_DOC_CHARS > 150_000);
});
