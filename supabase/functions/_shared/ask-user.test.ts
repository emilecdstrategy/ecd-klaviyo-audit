import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateQuestion } from "./ask-user.ts";

const yesNo = [
  { label: "Yes", value: "Yes" },
  { label: "No", value: "No" },
];

Deno.test("several questions come back as a sequence, first one mirrored at the top", () => {
  const r = validateQuestion({
    questions: [
      { question: "Exclude dedicated SEO work?", options: yesNo },
      { question: "Keep a phone-order path?", options: yesNo, multi_select: false },
      { question: "Which top-5 data source?", options: [{ label: "Shopify", value: "Use Shopify sales" }, { label: "Manual", value: "Manual list" }] },
    ],
  });
  assert(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assertEquals(r.value.questions?.length, 3);
  assertEquals(r.value.question, "Exclude dedicated SEO work?");
  assertEquals(r.value.options, yesNo);
  assertEquals(r.value.questions?.[2].options[0].value, "Use Shopify sales");
});

Deno.test("a single question has no questions list, same shape as before", () => {
  const r = validateQuestion({ question: "Include SEO?", options: yesNo });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.questions, undefined);
  assertEquals(r.value.allow_other, true);
});

Deno.test("a top-level question plus a list is merged without duplicates", () => {
  const r = validateQuestion({
    question: "Include SEO?",
    options: yesNo,
    questions: [
      { question: "Include SEO?", options: yesNo },
      { question: "Phone orders?", options: yesNo },
    ],
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.questions?.map((q) => q.question), ["Include SEO?", "Phone orders?"]);
});

Deno.test("a broken entry is dropped, the rest still ask", () => {
  const r = validateQuestion({
    questions: [
      { question: "", options: yesNo },
      { question: "Phone orders?", options: yesNo },
      { question: "SEO?", options: yesNo },
    ],
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.questions?.length, 2);
});

Deno.test("only one usable entry in the list is a plain single question", () => {
  const r = validateQuestion({ questions: [{ question: "SEO?", options: yesNo }, { question: "x", options: [] }] });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.question, "SEO?");
  assertEquals(r.value.questions, undefined);
});

Deno.test("more than four questions are capped", () => {
  const qs = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}?`, options: yesNo }));
  const r = validateQuestion({ questions: qs });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.value.questions?.length, 4);
});

Deno.test("nothing usable is an error the model can act on", () => {
  const r = validateQuestion({ questions: [] });
  assert(!r.ok);
});
