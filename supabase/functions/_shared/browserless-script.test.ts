// The browser-side script is injected as a STRING, so a syntax error in it is
// invisible to deno check and shows up only as every capture failing. It once
// shipped `/add \+|\+ add/i` written with a single backslash: the template
// literal ate it, the browser got `add +|+ add`, and that is not a valid regex,
// so every collection capture on a live audit died with bl_attempts climbing.
//
// Run with: npx deno test --allow-read supabase/functions/_shared/
import { FUNCTION_CODE } from "./browserless.ts";

Deno.test("the injected browser script parses", () => {
  // The script is an ES module (export default async ({page, context}) => ...),
  // so it is parsed as the arrow expression it is. new Function compiles without
  // executing, which is exactly the check we want: no DOM, no network, just
  // "would the browser accept this".
  const expr = FUNCTION_CODE
    .replace(/^\s*export\s+default\s*/, "")
    // The module ends "};" so the arrow needs its trailing semicolon removed
    // before it can be parenthesised as an expression.
    .trim()
    .replace(/;$/, "");
  new Function("return (" + expr + ");");
});

Deno.test("the injected script carries real regex escapes, not eaten ones", () => {
  // A collapsed escape leaves telltale patterns that are legal JS but wrong, so
  // parsing alone would not catch them.
  const eaten = [
    { pattern: "/s+/g", why: "whitespace regex lost its backslash" },
    { pattern: "add +|+ add", why: "quantifier with nothing to repeat" },
    { pattern: "/d+/", why: "digit regex lost its backslash" },
    { pattern: "error 10dd", why: "the Cloudflare error-code digits lost their backslashes" },
  ];
  for (const { pattern, why } of eaten) {
    if (FUNCTION_CODE.includes(pattern)) {
      throw new Error(`injected script contains "${pattern}": ${why}`);
    }
  }
});

Deno.test("the injected script has no template interpolation left in it", () => {
  // It is built as a template literal, so a stray ${...} would be resolved at
  // module load with whatever happened to be in scope.
  if (FUNCTION_CODE.includes("${")) throw new Error("injected script contains ${...}");
});
