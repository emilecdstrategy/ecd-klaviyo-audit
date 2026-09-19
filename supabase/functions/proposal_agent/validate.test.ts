import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateQuestion } from "./validate.ts";

// The real payload from 2026-09-19, off the proposal at 2a449d2b after "Fit it
// for ~$10k to match his budget". The model wrote its own function-call markup
// inside the options string instead of emitting JSON, so options arrived as
// text and the tail of the second option was stranded as a sibling "value" key.
// The user saw: "The assistant produced an invalid ask_user payload:
// ask_user.options must have 2-4 entries".
const LEAKED_OPTIONS =
  '\n<parameter name="label">Phase 1 core under $10K</parameter>\n' +
  '<parameter name="value">Phase it: a Phase 1 core scope priced under $10K (navigation restructure, ' +
  'product filters, app audit and cleanup, premium/luxury polish, PDP cross-sell, liquidation section, ' +
  'GA access recovery), with SEO and other extras noted as a later phase quoted separately.</parameter>\n' +
  '</invoke>\n<invoke name="ask_user">\n<parameter name="label">Everything, trimmed to fit';

Deno.test("a question whose options leaked as function-call markup is recovered, not refused", () => {
  const result = validateQuestion({
    question: "How do you want to fit the work to his ~$10K ceiling?",
    options: LEAKED_OPTIONS,
    value: "Keep all the deliverables including SEO but trim depth so the total lands around $10K.",
  });
  assert(result.ok, result.ok ? "" : result.error);
  if (!result.ok) return;
  assertEquals(result.value.options.length, 2);
  assertEquals(result.value.options[0].label, "Phase 1 core under $10K");
  assertStringIncludes(result.value.options[0].value, "Phase it: a Phase 1 core scope priced under $10K");
  assertStringIncludes(result.value.options[0].value, "quoted separately.");
  // The stranded sibling key belongs to the option the markup cut short.
  assertEquals(result.value.options[1].label, "Everything, trimmed to fit");
  assertStringIncludes(result.value.options[1].value, "trim depth so the total lands around $10K");
  // No markup survives into what the user clicks.
  assert(!JSON.stringify(result.value).includes("<parameter"), "markup leaked into the question");
  assert(!JSON.stringify(result.value).includes("invoke"), "markup leaked into the question");
});

Deno.test("an ordinary question passes through untouched", () => {
  const result = validateQuestion({
    question: "Which tier fits?",
    options: [
      { label: "Tier 1", value: "Go with Tier 1 at $3,000 a month." },
      { label: "Tier 2", value: "Go with Tier 2 at $5,500 a month." },
    ],
    multi_select: true,
  });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.value.options.length, 2);
  assertEquals(result.value.options[1].label, "Tier 2");
  assertEquals(result.value.multi_select, true);
  assertEquals(result.value.allow_other, true);
});

Deno.test("options JSON-encoded as a string are parsed", () => {
  const result = validateQuestion({
    question: "Keep SEO?",
    options: JSON.stringify([
      { label: "Keep it", value: "Keep SEO in scope." },
      { label: "Drop it", value: "Drop SEO for now." },
    ]),
  });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.value.options.map((o) => o.label), ["Keep it", "Drop it"]);
});

Deno.test("a single option is a working question, since there is always a free-text Other", () => {
  const result = validateQuestion({
    question: "Proceed?",
    options: [{ label: "Yes, proceed", value: "Yes, proceed with that scope." }],
  });
  assert(result.ok, result.ok ? "" : result.error);
  if (!result.ok) return;
  assertEquals(result.value.options.length, 1);
});

Deno.test("an option with only an answer gets a short chip to click", () => {
  const long =
    "Phase the work so that navigation, filters, the app cleanup and the PDP cross-sell land first, " +
    "and everything else is quoted later.";
  const result = validateQuestion({ question: "Which way?", options: [{ value: long }] });
  assert(result.ok);
  if (!result.ok) return;
  assert(result.value.options[0].label.length <= 61, result.value.options[0].label);
  assert(result.value.options[0].label.endsWith("..."));
  assertEquals(result.value.options[0].value, long);
});

Deno.test("too many options are trimmed rather than refused", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ label: `Option ${i}`, value: `Answer ${i}` }));
  const result = validateQuestion({ question: "Pick one", options: many });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.value.options.length, 6);
});

Deno.test("unreadable options fail with a message the model can act on", () => {
  const result = validateQuestion({ question: "Pick one", options: "just some prose, no options here" });
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertStringIncludes(result.error, "JSON array");
  // The old message blamed the count, which was never the problem.
  assert(!result.error.includes("2-4 entries"));
});

Deno.test("a question with no options at all is still refused", () => {
  const result = validateQuestion({ question: "Pick one", options: [] });
  assertEquals(result.ok, false);
  const missing = validateQuestion({ options: [{ label: "a", value: "b" }] });
  assertEquals(missing.ok, false);
});
