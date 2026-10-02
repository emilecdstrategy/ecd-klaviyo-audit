import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deviceGapWords } from "./shopify-sessions.ts";

Deno.test("a device gap is put into the right words", () => {
  // Simple & Dainty, Sep 30: desktop 0.91% against mobile 1.81% is 50.3%, about
  // half. The report said "less than half".
  assertEquals(deviceGapWords(50.3, "desktop", "mobile"), "So desktop converts at about half the rate of mobile.");
  assertEquals(deviceGapWords(30, "desktop", "mobile"), "So desktop converts at less than half the rate of mobile.");
  assertEquals(deviceGapWords(72, "desktop", "mobile"), "So desktop converts below mobile, at about 70% of its rate.");
  assertEquals(deviceGapWords(97, "desktop", "mobile"), "So desktop and mobile convert at about the same rate.");
});
